/**
 * Changing a person's default hourly rate, effective from a calendar day
 * ("Applies from", Wave E 2026-11). ADMIN only; the route checks the role, this
 * module validates and writes.
 *
 * STORAGE: `UserPayRate` rows (never edited). The rate for a job is resolved by
 * `PayRateBook` (lib/accounts/pay-rate-resolve.ts) on the job's calendar date.
 * `User.hourlyRate` is kept as the rate in force on the day it was last
 * changed (and is the fallback for people with no history); readers that
 * need a date use the book.
 *
 * WHAT A CHANGE AFFECTS — read from the pay code, not assumed:
 *  - computeCleanerPay (lib/finance/job-money) uses, in order: the
 *    assignment's payRate snapshot, the per-cleaner job-type rate in settings,
 *    then this default rate ON THE JOB'S DATE. QA inspection pay uses the
 *    inspection's own rate, then this default on the job's date, then the
 *    settings default.
 *  - "Applies from" is today or a later day (Sydney calendar). It can never
 *    be backdated, so a job already worked keeps the rate in force on its day.
 *  - Amounts already frozen are untouched: payroll payouts and run totals,
 *    submitted cleaner invoices, settled shopping and QA pay, assignment rate
 *    snapshots. This module writes only `UserPayRate`, `User.hourlyRate` (for
 *    a rate that applies from today) and an audit row.
 *  - A future row can be removed before it starts (tombstone, audited). Rows
 *    already in force are never edited or removed.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import { PayRateBook, calendarDayKey, rowInForce, type PayRateRow } from "./pay-rate-resolve";

export { MAX_HOURLY_RATE, MIN_HOURLY_RATE, payRateSchema } from "./pay-rate-rules";

/** How far ahead a rate may be scheduled. */
export const MAX_APPLIES_FROM_DAYS_AHEAD = 366;
/** The day the backfilled "rate before history existed" row applies from. */
export const BASELINE_EFFECTIVE_FROM = "1970-01-01";

export type PayRateChange = {
  id: string;
  before: number | null;
  after: number;
  appliesFrom: string;
  changed: boolean;
  /** Id of the history row written (null when unchanged). */
  entryId: string | null;
  /** A future row on the same day that this save replaced. */
  replacedEntryId: string | null;
};

export class PayRateError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message);
    this.name = "PayRateError";
  }
}

type Tx = Prisma.TransactionClient;
type PayRateSource = "EDITOR" | "BULK";

function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function toRow(entry: { userId: string; hourlyRate: number; effectiveFrom: Date; createdAt: Date }): PayRateRow {
  return { userId: entry.userId, hourlyRate: entry.hourlyRate, effectiveFrom: calendarDayKey(entry.effectiveFrom), createdAt: entry.createdAt };
}

/** Validate an "Applies from" day against today (Sydney). Returns the day key. */
export function checkAppliesFrom(appliesFrom: string | undefined, today: string): string {
  const key = appliesFrom ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number.isNaN(dateOnly(key).getTime()) || calendarDayKey(dateOnly(key)) !== key) {
    throw new PayRateError("Choose the day the rate applies from (YYYY-MM-DD).", 400);
  }
  if (key < today) throw new PayRateError("A rate cannot apply from a past day. Jobs already worked keep the rate in force on their day.", 400);
  if (key > addDaysToKey(today, MAX_APPLIES_FROM_DAYS_AHEAD)) throw new PayRateError("A rate can be scheduled at most a year ahead.", 400);
  return key;
}

/** Load every active history row for these people into one resolver. */
export async function loadPayRateBook(userIds: Iterable<string>, client: Pick<Tx, "userPayRate"> = db): Promise<PayRateBook> {
  const ids = Array.from(new Set(Array.from(userIds).filter(Boolean)));
  if (ids.length === 0) return new PayRateBook([]);
  const rows = await client.userPayRate.findMany({
    where: { userId: { in: ids }, removedAt: null },
    select: { userId: true, hourlyRate: true, effectiveFrom: true, createdAt: true },
  });
  return new PayRateBook(rows.map(toRow));
}

/**
 * Write the new default rate from `appliesFrom`, audit old and new values.
 * The first change for a person who has a rate but no history writes a
 * baseline row first, so every earlier job keeps resolving to that rate.
 */
export async function updateHourlyRate(
  actorId: string,
  userId: string,
  hourlyRate: number,
  options: { appliesFrom?: string; source?: PayRateSource; now?: Date } = {},
): Promise<PayRateChange> {
  const after = Math.round(hourlyRate * 100) / 100;
  const today = sydneyTodayKey(options.now ?? new Date());
  const appliesFrom = checkAppliesFrom(options.appliesFrom, today);
  return db.$transaction(async (tx) => {
    // Serialise rate changes for this person (two admins saving at once).
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const existing = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, hourlyRate: true } });
    if (!existing) throw new PayRateError("User not found.", 404);
    if (existing.role === "CLIENT" || existing.role === "VA") {
      throw new PayRateError("Client-side accounts are not paid an hourly rate.", 400);
    }
    const active = await tx.userPayRate.findMany({
      where: { userId, removedAt: null },
      select: { id: true, userId: true, hourlyRate: true, effectiveFrom: true, createdAt: true },
    });
    if (active.length === 0 && existing.hourlyRate === after) {
      return { id: userId, before: after, after, appliesFrom, changed: false, entryId: null, replacedEntryId: null };
    }
    if (active.length === 0 && existing.hourlyRate !== null) {
      const baseline = await tx.userPayRate.create({
        data: { userId, hourlyRate: existing.hourlyRate, effectiveFrom: dateOnly(BASELINE_EFFECTIVE_FROM), source: "BACKFILL", createdById: null },
        select: { id: true, userId: true, hourlyRate: true, effectiveFrom: true, createdAt: true },
      });
      active.push(baseline);
    }
    const rows = active.map(toRow);
    const before = rows.length ? rowInForce(rows, appliesFrom)?.hourlyRate ?? null : existing.hourlyRate;
    const sameDay = active.filter((entry) => calendarDayKey(entry.effectiveFrom) === appliesFrom);
    if (before === after && sameDay.length === 0) {
      return { id: userId, before, after, appliesFrom, changed: false, entryId: null, replacedEntryId: null };
    }
    // A FUTURE row on the same day is replaced (tombstoned); a row already in
    // force today stays in history and the newer save wins for the day.
    const replaced = appliesFrom > today ? sameDay[0] ?? null : null;
    if (replaced) {
      await tx.userPayRate.update({ where: { id: replaced.id }, data: { removedAt: new Date(), removedById: actorId } });
    }
    const entry = await tx.userPayRate.create({
      data: { userId, hourlyRate: after, effectiveFrom: dateOnly(appliesFrom), source: options.source ?? "EDITOR", createdById: actorId },
      select: { id: true },
    });
    if (appliesFrom === today) {
      await tx.user.update({ where: { id: userId }, data: { hourlyRate: after }, select: { id: true } });
    }
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "UPDATE_USER_PAY_RATE",
        entity: "User",
        entityId: userId,
        before: { hourlyRate: before, replacedEntryId: replaced?.id ?? null },
        after: { hourlyRate: after, appliesFrom, entryId: entry.id, source: options.source ?? "EDITOR" },
      },
    });
    return { id: userId, before, after, appliesFrom, changed: true, entryId: entry.id, replacedEntryId: replaced?.id ?? null };
  });
}

/** Remove a rate that has not started yet. Rows in force are never removed. */
export async function removeFuturePayRate(actorId: string, userId: string, entryId: string, now: Date = new Date()): Promise<{ removed: true }> {
  const today = sydneyTodayKey(now);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const entry = await tx.userPayRate.findFirst({ where: { id: entryId, userId }, select: { id: true, hourlyRate: true, effectiveFrom: true, removedAt: true } });
    if (!entry) throw new PayRateError("That rate is not in this person's history.", 404);
    if (entry.removedAt) throw new PayRateError("That rate was already removed.", 409);
    const day = calendarDayKey(entry.effectiveFrom);
    if (day <= today) throw new PayRateError("This rate has already started. Rates in force are kept as history; set a new rate instead.", 409);
    await tx.userPayRate.update({ where: { id: entry.id }, data: { removedAt: new Date(), removedById: actorId } });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "REMOVE_USER_PAY_RATE",
        entity: "User",
        entityId: userId,
        before: { entryId: entry.id, hourlyRate: entry.hourlyRate, appliesFrom: day },
      },
    });
    return { removed: true as const };
  });
}
