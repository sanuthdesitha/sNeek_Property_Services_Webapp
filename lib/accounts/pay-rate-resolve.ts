/**
 * THE resolver for a person's default hourly rate on a given calendar day.
 * Pure: no database, no clock (callers pass "today"), safe for tests and the
 * browser.
 *
 * Rule (Wave E, 2026-11):
 *  - The rate for a day is the newest non-removed history row whose
 *    `effectiveFrom` is on or before that day. Two rows on the same day: the
 *    one saved later wins (a same-day correction never edits the first row).
 *  - A person with NO history rows falls back to `User.hourlyRate`, exactly
 *    the rate every pay path read before history existed (accounts created
 *    after the backfill by a path that writes the column directly).
 *  - A person WITH history but no row on or before the day has no default
 *    rate for that day (null). Null is never turned into zero: the pay
 *    calculators fall through to their own next source (settings default).
 *
 * Every pay path that used to read `User.hourlyRate` for a job reads
 * `PayRateBook.rateFor(userId, job.scheduledDate, user.hourlyRate)` instead.
 * Rate snapshots already stored (assignment payRate, payouts, invoice lines,
 * QA settled pay) are read BEFORE this, by the calculators, and never change.
 */

export type PayRateRow = {
  userId: string;
  hourlyRate: number;
  /** yyyy-MM-dd calendar date. */
  effectiveFrom: string;
  createdAt: Date | string;
};

/** Calendar day of a stored @db.Date / UTC-midnight date (never shifted to a timezone). */
export function calendarDayKey(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function createdMillis(row: PayRateRow): number {
  return new Date(row.createdAt).getTime();
}

/** Newest first: later effective day, then later save. */
export function compareNewestFirst(left: PayRateRow, right: PayRateRow): number {
  if (left.effectiveFrom !== right.effectiveFrom) return left.effectiveFrom < right.effectiveFrom ? 1 : -1;
  return createdMillis(right) - createdMillis(left);
}

/** The row in force on `dayKey`, or null when none had started. */
export function rowInForce(rows: readonly PayRateRow[], dayKey: string): PayRateRow | null {
  let best: PayRateRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > dayKey) continue;
    if (!best || compareNewestFirst(row, best) < 0) best = row;
  }
  return best;
}

export class PayRateBook {
  private readonly byUser = new Map<string, PayRateRow[]>();

  constructor(rows: readonly PayRateRow[]) {
    for (const row of rows) {
      const list = this.byUser.get(row.userId) ?? [];
      list.push(row);
      this.byUser.set(row.userId, list);
    }
  }

  hasHistory(userId: string): boolean {
    return (this.byUser.get(userId)?.length ?? 0) > 0;
  }

  /**
   * The default rate for `userId` on the calendar day of `date`.
   * `fallbackUserRate` is the person's `User.hourlyRate`, used only when they
   * have no history rows at all.
   */
  rateFor(userId: string | null | undefined, date: Date | string | null | undefined, fallbackUserRate: number | null | undefined): number | null {
    if (!userId) return fallbackUserRate ?? null;
    const rows = this.byUser.get(userId);
    if (!rows || rows.length === 0) return fallbackUserRate ?? null;
    if (!date) return fallbackUserRate ?? null;
    return rowInForce(rows, calendarDayKey(date))?.hourlyRate ?? null;
  }
}

/** A book with no history: every lookup returns the fallback (tests, callers without people). */
export const EMPTY_PAY_RATE_BOOK = new PayRateBook([]);
