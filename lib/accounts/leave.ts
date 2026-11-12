/**
 * Leave and days off: storage and reads (Wave E, 2026-11). Rules and labels
 * are in ./leave-rules (pure). The routes check roles; this module validates
 * and writes. Records are never edited: a mistake is removed (tombstone,
 * audited) and recorded again. Leave that has fully ended is history and is
 * not removed.
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { leaveInputSchema, leaveOverlaps, leaveReason, type LeaveEntry, type LeaveInput, type LeaveKind } from "./leave-rules";

export class LeaveError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = "LeaveError";
  }
}

type LeaveRecord = { id: string; userId: string; startDate: Date; endDate: Date; kind: string; note: string | null };

const LEAVE_SELECT = { id: true, userId: true, startDate: true, endDate: true, kind: true, note: true } as const;

function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function toEntry(row: LeaveRecord): LeaveEntry {
  return {
    id: row.id,
    userId: row.userId,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    kind: (row.kind === "DAY_OFF" ? "DAY_OFF" : "LEAVE") as LeaveKind,
    note: row.note,
  };
}

export type PersonLeaveEntry = LeaveEntry & { createdAt: string; createdByName: string | null; removable: boolean; reason: string };

/** A person's leave that has not ended more than 90 days ago, newest first. */
export async function listPersonLeave(userId: string, now: Date = new Date()): Promise<PersonLeaveEntry[]> {
  const today = sydneyTodayKey(now);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000);
  const rows = await db.staffLeave.findMany({
    where: { userId, removedAt: null, endDate: { gte: since } },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    select: { ...LEAVE_SELECT, createdAt: true, createdBy: { select: { name: true, email: true } } },
  });
  return rows.map((row) => {
    const entry = toEntry(row);
    return {
      ...entry,
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdBy ? row.createdBy.name?.trim() || row.createdBy.email : null,
      removable: entry.endDate >= today,
      reason: leaveReason(entry),
    };
  });
}

/** Every person's leave touching [startKey, endKey], grouped by person. */
export async function loadLeaveForUsers(userIds: readonly string[], startKey: string, endKey: string): Promise<Map<string, LeaveEntry[]>> {
  const map = new Map<string, LeaveEntry[]>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return map;
  const rows = await db.staffLeave.findMany({
    where: { userId: { in: ids }, removedAt: null, startDate: { lte: dateOnly(endKey) }, endDate: { gte: dateOnly(startKey) } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: LEAVE_SELECT,
  });
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(toEntry(row));
    map.set(row.userId, list);
  }
  return map;
}

export async function createLeave(actorId: string, userId: string, raw: unknown): Promise<LeaveEntry> {
  const input: LeaveInput = leaveInputSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const person = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!person) throw new LeaveError("User not found.", 404);
    if (person.role === "CLIENT" || person.role === "VA") throw new LeaveError("Leave is recorded for staff only.", 400);
    const existing = await tx.staffLeave.findMany({
      where: { userId, removedAt: null, startDate: { lte: dateOnly(input.endDate) }, endDate: { gte: dateOnly(input.startDate) } },
      select: LEAVE_SELECT,
    });
    const clash = existing.map(toEntry).find((entry) => leaveOverlaps(entry, input));
    if (clash) throw new LeaveError(`This overlaps ${leaveReason(clash).toLowerCase()}. Remove that record first or choose other days.`, 409);
    const created = await tx.staffLeave.create({
      data: { userId, startDate: dateOnly(input.startDate), endDate: dateOnly(input.endDate), kind: input.kind, note: input.note || null, createdById: actorId },
      select: LEAVE_SELECT,
    });
    await tx.auditLog.create({
      data: { userId: actorId, action: "STAFF_LEAVE_RECORDED", entity: "User", entityId: userId, after: { leaveId: created.id, ...input } as Prisma.InputJsonValue },
    });
    return toEntry(created);
  });
}

export async function removeLeave(actorId: string, userId: string, leaveId: string, now: Date = new Date()): Promise<{ removed: true }> {
  const today = sydneyTodayKey(now);
  return db.$transaction(async (tx) => {
    const row = await tx.staffLeave.findFirst({ where: { id: leaveId, userId }, select: { ...LEAVE_SELECT, removedAt: true } });
    if (!row) throw new LeaveError("That record is not in this person's leave.", 404);
    if (row.removedAt) throw new LeaveError("That record was already removed.", 409);
    const entry = toEntry(row);
    if (entry.endDate < today) throw new LeaveError("Leave that has ended is kept as history.", 409);
    await tx.staffLeave.update({ where: { id: leaveId }, data: { removedAt: new Date(), removedById: actorId } });
    await tx.auditLog.create({
      data: { userId: actorId, action: "STAFF_LEAVE_REMOVED", entity: "User", entityId: userId, before: { leaveId, startDate: entry.startDate, endDate: entry.endDate, kind: entry.kind } },
    });
    return { removed: true as const };
  });
}
