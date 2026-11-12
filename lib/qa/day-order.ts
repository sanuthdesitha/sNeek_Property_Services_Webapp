/**
 * Who sets an inspector's visit order for a day (owner decision 2026-11-12:
 * "inspectors can reorder their own day, but office can set the order and if
 * the order is set they can't change it").
 *
 * - The order itself is QaAssignment.sequence, as before.
 * - QaDayOrder records who last set it for (inspector, Sydney day). When the
 *   office orders ANOTHER inspector's day it is `locked`; the inspector's own
 *   reorder is then refused with "Order set by the office" until the office
 *   clears it ("Let inspector reorder"). An office member ordering their own
 *   day records it without a lock.
 * - An inspector's reorder never sets or clears a lock, only ever touches
 *   their own active assignments for that day, and must match the order they
 *   last read (stale-write guard). Both paths serialise on one advisory lock
 *   per inspector-day so a lock and a reorder cannot interleave.
 *
 * Authorisation (live session, role, impersonation) is the routes' job; this
 * module enforces scope and the lock inside the transaction.
 */
import { QaAssignmentStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

type Tx = Prisma.TransactionClient;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "today" | "tomorrow" | YYYY-MM-DD → a Sydney YYYY-MM-DD key, or null. */
export function resolveDayKey(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const today = sydneyTodayKey(now);
  if (trimmed === "today") return today;
  if (trimmed === "tomorrow") return addDaysToKey(today, 1);
  const match = DAY_KEY.exec(trimmed);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible dates such as 2026-02-31 (the cursor would roll over).
  return addDaysToKey(trimmed, 0) === trimmed ? trimmed : null;
}

/** The DATE column value for a day key (midnight UTC; DATE stores no zone). */
export function dayKeyToDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

/** Active assignments an inspector holds for one Sydney day, in visit order. */
export function inspectorDayWhere(inspectorId: string, dayKey: string): Prisma.QaAssignmentWhereInput {
  const window = { gte: sydneyDayStart(dayKey), lt: sydneyDayStart(addDaysToKey(dayKey, 1)) };
  return {
    assignedToId: inspectorId,
    status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
    OR: [{ scheduledFor: window }, { AND: [{ scheduledFor: null }, { job: { scheduledDate: window } }] }],
  };
}

/** The same ordering the QA queue uses (GET /api/qa/queue). */
export const VISIT_ORDER_BY: Prisma.QaAssignmentOrderByWithRelationInput[] = [
  { sequence: { sort: "asc", nulls: "last" } },
  { scheduledFor: { sort: "asc", nulls: "last" } },
  { dueAt: "asc" },
  { createdAt: "asc" },
];

async function lockInspectorDay(tx: Tx, inspectorId: string, dayKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`qa-day-order:${inspectorId}:${dayKey}`}))`;
}

async function currentDayOrder(tx: Tx, inspectorId: string, dayKey: string): Promise<string[]> {
  const rows = await tx.qaAssignment.findMany({
    where: inspectorDayWhere(inspectorId, dayKey),
    orderBy: VISIT_ORDER_BY,
    select: { id: true },
    take: 200,
  });
  return rows.map((row) => row.id);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

/** What a screen needs to show who set the order. */
export interface DayOrderState {
  dayKey: string;
  /** True: the office set it and the inspector may not change it. */
  locked: boolean;
  setByOffice: boolean;
  setByName: string | null;
  setAt: string | null;
  unlockedByName: string | null;
  unlockedAt: string | null;
}

export function unsetDayOrderState(dayKey: string): DayOrderState {
  return {
    dayKey,
    locked: false,
    setByOffice: false,
    setByName: null,
    setAt: null,
    unlockedByName: null,
    unlockedAt: null,
  };
}

export async function getDayOrderState(
  inspectorId: string,
  dayKey: string,
  database: typeof db | Tx = db
): Promise<DayOrderState> {
  const row = await database.qaDayOrder.findUnique({
    where: { inspectorId_day: { inspectorId, day: dayKeyToDate(dayKey) } },
    select: {
      locked: true,
      setByOffice: true,
      setAt: true,
      unlockedAt: true,
      setBy: { select: { name: true, email: true } },
      unlockedBy: { select: { name: true, email: true } },
    },
  });
  if (!row) return unsetDayOrderState(dayKey);
  return {
    dayKey,
    locked: row.locked,
    setByOffice: row.setByOffice,
    setByName: row.setBy ? row.setBy.name || row.setBy.email : null,
    setAt: row.setAt.toISOString(),
    unlockedByName: row.unlockedBy ? row.unlockedBy.name || row.unlockedBy.email : null,
    unlockedAt: row.unlockedAt ? row.unlockedAt.toISOString() : null,
  };
}

export type InspectorReorderResult =
  | { kind: "saved"; updated: number; state: DayOrderState }
  | { kind: "locked"; state: DayOrderState }
  | { kind: "stale"; currentOrder: string[] }
  | { kind: "invalid"; message: string };

/** Reason shown to the inspector when the office has set their day. */
export const OFFICE_LOCK_REASON = "Order set by the office";

/**
 * The inspector's own reorder. Refused while the office lock stands, when the
 * list is not exactly their active assignments for that day, or when the
 * order they last read is no longer the stored one.
 */
export async function reorderOwnDay(input: {
  inspectorId: string;
  dayKey: string;
  orderedAssignmentIds: string[];
  expectedOrder: string[];
}): Promise<InspectorReorderResult> {
  const ordered = input.orderedAssignmentIds;
  if (new Set(ordered).size !== ordered.length) {
    return { kind: "invalid", message: "Duplicate assignment ids in the order." };
  }
  return db.$transaction(async (tx) => {
    await lockInspectorDay(tx, input.inspectorId, input.dayKey);
    const state = await getDayOrderState(input.inspectorId, input.dayKey, tx);
    if (state.locked) return { kind: "locked", state } as const;

    const current = await currentDayOrder(tx, input.inspectorId, input.dayKey);
    if (!sameSet(ordered, current)) {
      // Not the inspector's whole day as stored: another inspector's visit, a
      // finished one, or the day changed since it was read.
      if (ordered.every((id) => current.includes(id))) return { kind: "stale", currentOrder: current } as const;
      return { kind: "invalid", message: "You can only reorder your own visits for that day." } as const;
    }
    if (!sameList(input.expectedOrder, current)) return { kind: "stale", currentOrder: current } as const;

    for (let index = 0; index < ordered.length; index += 1) {
      await tx.qaAssignment.update({ where: { id: ordered[index] }, data: { sequence: index + 1 } });
    }
    const now = new Date();
    await tx.qaDayOrder.upsert({
      where: { inspectorId_day: { inspectorId: input.inspectorId, day: dayKeyToDate(input.dayKey) } },
      create: {
        inspectorId: input.inspectorId,
        day: dayKeyToDate(input.dayKey),
        locked: false,
        setByOffice: false,
        setById: input.inspectorId,
        setAt: now,
      },
      update: { setByOffice: false, setById: input.inspectorId, setAt: now },
    });
    await tx.auditLog.create({
      data: {
        userId: input.inspectorId,
        action: "QA_VISIT_ORDER_SELF_REORDER",
        entity: "QaDayOrder",
        entityId: `${input.inspectorId}:${input.dayKey}`,
        before: { order: current } as Prisma.InputJsonValue,
        after: { order: ordered, date: input.dayKey } as Prisma.InputJsonValue,
      },
    });
    return {
      kind: "saved",
      updated: ordered.length,
      state: await getDayOrderState(input.inspectorId, input.dayKey, tx),
    } as const;
  });
}

/**
 * The office reorder (PATCH /api/admin/qa/assignments/reorder). Writes the
 * sequence and records the office as the setter; ordering another inspector's
 * day locks it. Ids must all be assigned to that inspector.
 */
export type OfficeReorderResult =
  | { kind: "saved"; updated: number; state: DayOrderState }
  | { kind: "invalid"; message: string };

export async function setOfficeDayOrder(input: {
  inspectorId: string;
  actorId: string;
  dayKey: string;
  orderedAssignmentIds: string[];
}): Promise<OfficeReorderResult> {
  const ids = input.orderedAssignmentIds;
  return db.$transaction(async (tx) => {
    await lockInspectorDay(tx, input.inspectorId, input.dayKey);
    const owned = await tx.qaAssignment.findMany({
      where: { id: { in: ids }, assignedToId: input.inspectorId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      return { kind: "invalid", message: "One or more assignments are not assigned to this inspector." } as const;
    }
    for (let index = 0; index < ids.length; index += 1) {
      await tx.qaAssignment.update({ where: { id: ids[index] }, data: { sequence: index + 1 } });
    }
    const locks = input.actorId !== input.inspectorId;
    const now = new Date();
    await tx.qaDayOrder.upsert({
      where: { inspectorId_day: { inspectorId: input.inspectorId, day: dayKeyToDate(input.dayKey) } },
      create: {
        inspectorId: input.inspectorId,
        day: dayKeyToDate(input.dayKey),
        locked: locks,
        setByOffice: true,
        setById: input.actorId,
        setAt: now,
      },
      update: { locked: locks, setByOffice: true, setById: input.actorId, setAt: now },
    });
    return {
      kind: "saved",
      updated: ids.length,
      state: await getDayOrderState(input.inspectorId, input.dayKey, tx),
    } as const;
  });
}

/** "Let inspector reorder": clears the office lock. The order itself stays. */
export async function clearOfficeDayLock(input: {
  inspectorId: string;
  actorId: string;
  dayKey: string;
}): Promise<DayOrderState> {
  return db.$transaction(async (tx) => {
    await lockInspectorDay(tx, input.inspectorId, input.dayKey);
    const before = await getDayOrderState(input.inspectorId, input.dayKey, tx);
    if (!before.locked) return before;
    await tx.qaDayOrder.update({
      where: { inspectorId_day: { inspectorId: input.inspectorId, day: dayKeyToDate(input.dayKey) } },
      data: { locked: false, unlockedById: input.actorId, unlockedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: "QA_VISIT_ORDER_UNLOCK",
        entity: "QaDayOrder",
        entityId: `${input.inspectorId}:${input.dayKey}`,
        before: { locked: true, setByName: before.setByName, setAt: before.setAt } as Prisma.InputJsonValue,
        after: { locked: false, date: input.dayKey } as Prisma.InputJsonValue,
      },
    });
    return getDayOrderState(input.inspectorId, input.dayKey, tx);
  });
}
