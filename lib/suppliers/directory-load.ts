import "server-only";
import { LaundryStatus, MaintenanceStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { dayKeyOf } from "@/lib/laundry/pipeline";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import type { LaundryPartnerStats, SupplierChaseRecord, TradeSupplierRecord } from "./directory-types";

/**
 * Read models behind the Suppliers directory that are not the supplier records
 * themselves: laundry partner figures from their runs, team login extras
 * (last seen, pending invitation) and trades (maintenance workers).
 * Nothing here writes.
 */

const OPEN_MAINTENANCE: MaintenanceStatus[] = [MaintenanceStatus.OPEN, MaintenanceStatus.ACKNOWLEDGED, MaintenanceStatus.IN_PROGRESS, MaintenanceStatus.ORDERED];
const NOT_PICKED: LaundryStatus[] = [LaundryStatus.PENDING, LaundryStatus.CONFIRMED, LaundryStatus.FLAGGED];

type PartnerRunFacts = { supplierId: string | null; status: LaundryStatus; pickupDate: Date; dropoffDate: Date; pickedUpAt: Date | null; droppedAt: Date | null; propertyId: string };

/** PURE: the figures for one partner from its runs. */
export function partnerStatsFromRuns(runs: readonly PartnerRunFacts[], turnaroundHours: number | null, now: Date, chases: SupplierChaseRecord[] = []): LaundryPartnerStats {
  const todayKey = sydneyTodayKey(now);
  const monthAgo = now.getTime() - 30 * 86_400_000;
  const twoMonthsAgo = now.getTime() - 60 * 86_400_000;
  let toPickUp = 0;
  let atLaundry = 0;
  let toDrop = 0;
  let late = 0;
  const hours: number[] = [];
  const properties = new Set<string>();
  for (const run of runs) {
    if (run.pickupDate.getTime() >= twoMonthsAgo || (run.droppedAt && run.droppedAt.getTime() >= twoMonthsAgo)) properties.add(run.propertyId);
    if (NOT_PICKED.includes(run.status)) {
      const pickupKey = dayKeyOf(run.pickupDate);
      if (pickupKey && pickupKey <= todayKey) toPickUp += 1;
    } else if (run.status === LaundryStatus.PICKED_UP) {
      const dropKey = dayKeyOf(run.dropoffDate);
      if (dropKey && dropKey <= todayKey) toDrop += 1;
      else atLaundry += 1;
      if (turnaroundHours && run.pickedUpAt && (now.getTime() - run.pickedUpAt.getTime()) / 3_600_000 > turnaroundHours) late += 1;
    } else if (run.status === LaundryStatus.DROPPED && run.pickedUpAt && run.droppedAt && run.droppedAt.getTime() >= monthAgo && run.droppedAt > run.pickedUpAt) {
      hours.push((run.droppedAt.getTime() - run.pickedUpAt.getTime()) / 3_600_000);
    }
  }
  const onTime = turnaroundHours && hours.length ? hours.filter((value) => value <= turnaroundHours).length : null;
  return {
    toPickUp,
    atLaundry,
    toDrop,
    late,
    onTimePct: onTime === null ? null : Math.round((onTime / hours.length) * 100),
    measuredRuns: hours.length,
    actualAvgHours: hours.length ? Math.round(hours.reduce((sum, value) => sum + value, 0) / hours.length) : null,
    recentProperties: properties.size,
    chases,
  };
}

async function loadChases(partnerIds: string[], now: Date): Promise<Map<string, SupplierChaseRecord[]>> {
  const out = new Map<string, SupplierChaseRecord[]>();
  if (!partnerIds.length) return out;
  const rows = await db.auditLog.findMany({
    where: { action: "LAUNDRY_SUPPLIER_CHASE_SENT", entity: "LaundryTask", createdAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { createdAt: true, entityId: true, after: true, user: { select: { name: true } } },
  });
  const taskIds = Array.from(new Set(rows.map((row) => row.entityId).filter((id): id is string => Boolean(id))));
  const tasks = taskIds.length ? await db.laundryTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, supplierId: true } }) : [];
  const supplierOf = new Map(tasks.map((task) => [task.id, task.supplierId]));
  for (const row of rows) {
    const supplierId = row.entityId ? supplierOf.get(row.entityId) : null;
    if (!supplierId || !partnerIds.includes(supplierId)) continue;
    const after = (row.after ?? {}) as { transport?: unknown; state?: unknown };
    const list = out.get(supplierId) ?? [];
    if (list.length >= 10) continue;
    list.push({ at: row.createdAt.toISOString(), byName: row.user?.name?.trim() || "Office", transport: typeof after.transport === "string" ? after.transport : "Unknown", state: typeof after.state === "string" ? after.state : "unknown", taskId: row.entityId });
    out.set(supplierId, list);
  }
  return out;
}

export async function loadPartnerStats(partners: ReadonlyArray<{ id: string; avgTurnaround: number | null }>, now = new Date()): Promise<Map<string, LaundryPartnerStats>> {
  const ids = partners.map((partner) => partner.id);
  const out = new Map<string, LaundryPartnerStats>();
  if (!ids.length) return out;
  const since = new Date(now.getTime() - 60 * 86_400_000);
  const [runs, chases] = await Promise.all([
    db.laundryTask.findMany({
      where: {
        supplierId: { in: ids },
        OR: [{ status: { in: [...NOT_PICKED, LaundryStatus.PICKED_UP] } }, { droppedAt: { gte: since } }, { pickupDate: { gte: since } }],
      },
      select: { supplierId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, droppedAt: true, propertyId: true },
      take: 5000,
    }),
    loadChases(ids, now),
  ]);
  for (const partner of partners) {
    out.set(partner.id, partnerStatsFromRuns(runs.filter((run) => run.supplierId === partner.id), partner.avgTurnaround, now, chases.get(partner.id) ?? []));
  }
  return out;
}

/** Last seen and pending invitation for laundry team logins. */
export async function loadLoginExtras(userIds: string[], now = new Date()): Promise<Map<string, { lastSeenAt: string | null; invitedAt: string | null }>> {
  const out = new Map<string, { lastSeenAt: string | null; invitedAt: string | null }>();
  if (!userIds.length) return out;
  const [users, invitations] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, lastSeenAt: true } }),
    db.userInvitation.findMany({ where: { userId: { in: userIds }, acceptedAt: null, expiresAt: { gt: now } }, select: { userId: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const invited = new Map<string, Date>();
  for (const row of invitations) if (row.userId && !invited.has(row.userId)) invited.set(row.userId, row.createdAt);
  for (const user of users) out.set(user.id, { lastSeenAt: user.lastSeenAt?.toISOString() ?? null, invitedAt: invited.get(user.id)?.toISOString() ?? null });
  return out;
}

/** Trades: maintenance workers with their portal login and open assigned items. */
export async function loadTrades(): Promise<TradeSupplierRecord[]> {
  const [workers, open] = await Promise.all([
    db.maintenanceWorker.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true, name: true, company: true, trade: true, phone: true, email: true, notes: true, isActive: true, isPermanent: true,
        user: { select: { id: true, email: true, isActive: true, lastSeenAt: true, role: true } },
      },
    }),
    db.propertyMaintenanceItem.groupBy({ by: ["assignedWorkerId"], where: { assignedWorkerId: { not: null }, status: { in: OPEN_MAINTENANCE } }, _count: { _all: true } }),
  ]);
  const openBy = new Map(open.map((row) => [row.assignedWorkerId as string, row._count._all]));
  return workers.map((worker) => ({
    id: worker.id,
    name: worker.company?.trim() || worker.name,
    company: worker.company,
    trade: worker.trade,
    phone: worker.phone,
    email: worker.email,
    notes: worker.notes,
    isActive: worker.isActive,
    isPermanent: worker.isPermanent,
    login: worker.user && worker.user.role === Role.MAINTENANCE ? { id: worker.user.id, email: worker.user.email, isActive: worker.user.isActive, lastSeenAt: worker.user.lastSeenAt?.toISOString() ?? null } : null,
    openCases: openBy.get(worker.id) ?? 0,
  }));
}
