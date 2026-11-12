/**
 * Reading a person's rate history for the Pay section, and the rate in force
 * today for screens that show "the current rate" (Accounts list, person panel,
 * cleaners roster). Writes live in ./pay-rate.ts.
 */
import { db } from "@/lib/db";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { calendarDayKey, compareNewestFirst, rowInForce, type PayRateRow } from "./pay-rate-resolve";
import { loadPayRateBook } from "./pay-rate";

export type PayRateHistoryState = "FUTURE" | "CURRENT" | "PAST" | "REMOVED";

export type PayRateHistoryEntry = {
  id: string;
  hourlyRate: number;
  effectiveFrom: string;
  source: string;
  createdAt: string;
  createdByName: string | null;
  removedAt: string | null;
  state: PayRateHistoryState;
  /** True only for a future, non-removed row: the one action allowed on history. */
  removable: boolean;
};

export type PayRateHistory = { today: string; entries: PayRateHistoryEntry[] };

export async function listPayRateHistory(userId: string, now: Date = new Date()): Promise<PayRateHistory> {
  const today = sydneyTodayKey(now);
  const rows = await db.userPayRate.findMany({
    where: { userId },
    select: {
      id: true, userId: true, hourlyRate: true, effectiveFrom: true, source: true, createdAt: true, removedAt: true,
      createdBy: { select: { name: true, email: true } },
    },
  });
  const activeRows: PayRateRow[] = rows
    .filter((row) => !row.removedAt)
    .map((row) => ({ userId: row.userId, hourlyRate: row.hourlyRate, effectiveFrom: calendarDayKey(row.effectiveFrom), createdAt: row.createdAt }));
  const current = rowInForce(activeRows, today);
  const currentId = current ? rows.find((row) => !row.removedAt && row.createdAt.getTime() === new Date(current.createdAt).getTime() && calendarDayKey(row.effectiveFrom) === current.effectiveFrom)?.id ?? null : null;
  const entries = rows.map((row): PayRateHistoryEntry => {
    const day = calendarDayKey(row.effectiveFrom);
    const state: PayRateHistoryState = row.removedAt ? "REMOVED" : day > today ? "FUTURE" : row.id === currentId ? "CURRENT" : "PAST";
    return {
      id: row.id,
      hourlyRate: row.hourlyRate,
      effectiveFrom: day,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdBy ? row.createdBy.name?.trim() || row.createdBy.email : null,
      removedAt: row.removedAt?.toISOString() ?? null,
      state,
      removable: state === "FUTURE",
    };
  });
  entries.sort((left, right) => compareNewestFirst(
    { userId, hourlyRate: left.hourlyRate, effectiveFrom: left.effectiveFrom, createdAt: left.createdAt },
    { userId, hourlyRate: right.hourlyRate, effectiveFrom: right.effectiveFrom, createdAt: right.createdAt },
  ));
  return { today, entries };
}

/** The rate in force today for each person (history first, else User.hourlyRate). */
export async function currentHourlyRates(people: ReadonlyArray<{ id: string; hourlyRate: number | null }>, now: Date = new Date()): Promise<Map<string, number | null>> {
  const book = await loadPayRateBook(people.map((person) => person.id));
  const today = sydneyTodayKey(now);
  return new Map(people.map((person) => [person.id, book.rateFor(person.id, today, person.hourlyRate)]));
}

/** The next scheduled change after today, for the "from Mon 16 Nov" hint. */
export function nextScheduledRate(history: PayRateHistory): PayRateHistoryEntry | null {
  const future = history.entries.filter((entry) => entry.state === "FUTURE");
  return future.length ? future[future.length - 1] : null;
}
