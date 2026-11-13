/**
 * Laundry team and supplier accountability figures (moved out of the old
 * accountability overview route so the Laundry statistics page can show them
 * and the overview route stays a thin caller). The arithmetic is unchanged:
 * lib/accountability/laundry-stats.ts attributes each pickup/drop to the user
 * who confirmed it; stuck PENDING/CONFIRMED tasks have no actor yet and only
 * appear in teamTotals.stuckUnattributed.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import {
  computeLaundryTeamStats,
  type LaundryConfirmationLite,
  type LaundryTaskLite,
  type LaundryTeamTotals,
  type LaundryUserStats,
} from "@/lib/accountability/laundry-stats";
import { NOT_VOIDED } from "@/lib/laundry/void-scope";

export type LaundryTeamMember = LaundryUserStats & { name: string };

export type LaundrySupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  pricePerKg: number | null;
  avgTurnaround: number | null;
  reliabilityScore: number | null;
  tasksInPeriod: number;
};

export type LaundryTeamMetrics = {
  team: LaundryTeamMember[];
  teamTotals: LaundryTeamTotals;
  suppliers: LaundrySupplierRow[];
};

/** `windowStart` is the period's first instant; activity runs up to `now`. */
export async function getLaundryTeamMetrics(windowStart: Date, now: Date = new Date()): Promise<LaundryTeamMetrics> {
  // Tasks with pickup/drop activity in the window, plus any still-open task
  // (needed for stuck detection regardless of age).
  const [laundryUsers, laundryTasks, laundrySuppliers] = await Promise.all([
    db.user.findMany({
      where: { role: Role.LAUNDRY, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.laundryTask.findMany({
      where: {
        ...NOT_VOIDED,
        OR: [
          { pickedUpAt: { gte: windowStart } },
          { droppedAt: { gte: windowStart } },
          { status: { in: ["PENDING", "CONFIRMED", "PICKED_UP", "READY_TO_RETURN"] } },
        ],
      },
      select: {
        id: true,
        status: true,
        pickupDate: true,
        dropoffDate: true,
        pickedUpAt: true,
        droppedAt: true,
        supplierId: true,
      },
    }),
    db.laundrySupplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true, phone: true, pricePerKg: true, avgTurnaround: true, reliabilityScore: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const confirmations: LaundryConfirmationLite[] =
    laundryTasks.length > 0
      ? await db.laundryConfirmation.findMany({
          where: { laundryTaskId: { in: laundryTasks.map((t) => t.id) } },
          select: { laundryTaskId: true, confirmedById: true, photoUrl: true, s3Key: true, notes: true, createdAt: true },
        })
      : [];

  const stats = computeLaundryTeamStats({
    tasks: laundryTasks as LaundryTaskLite[],
    confirmations,
    rangeStart: windowStart,
    rangeEnd: now,
    now,
    userIds: laundryUsers.map((u) => u.id),
  });
  const nameById = new Map(laundryUsers.map((u) => [u.id, u.name ?? "Laundry"]));
  const rosterIds = new Set(laundryUsers.map((u) => u.id));
  // Active LAUNDRY roster first (zero-activity rows included); attributed
  // activity from since-deactivated accounts still shows, so totals reconcile.
  const team = stats.perUser
    .filter((row) => rosterIds.has(row.userId) || row.pickups > 0 || row.drops > 0 || row.stuckCount > 0)
    .map((row) => ({ ...row, name: nameById.get(row.userId) ?? "Former team member" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const supplierTaskCounts = new Map<string, number>();
  for (const task of laundryTasks) {
    if (!task.supplierId || !task.droppedAt || task.droppedAt < windowStart) continue;
    supplierTaskCounts.set(task.supplierId, (supplierTaskCounts.get(task.supplierId) ?? 0) + 1);
  }
  const suppliers = laundrySuppliers.map((supplier) => ({
    ...supplier,
    tasksInPeriod: supplierTaskCounts.get(supplier.id) ?? 0,
  }));

  return { team, teamTotals: stats.teamTotals, suppliers };
}
