import { formatInTimeZone } from "date-fns-tz";

/**
 * ONE DAY'S TRAVEL, PAID ONCE.
 *
 * The owner's rule is a transport allowance PER DAY. An inspector who visits
 * four properties on a Tuesday made one journey, not four, so the allowance
 * attaches to the day — multiplying it by the number of inspections would be
 * paying for journeys nobody made.
 *
 * DISTINCT FROM THE CLEANER ONE. `jobMeta.transportAllowances[cleanerId]` is
 * per-JOB and lives in `computeCleanerPay`. Reusing it here would have tied a
 * day's travel to a single inspection and reintroduced exactly the multiplying
 * this exists to avoid.
 *
 * THE DAY IS A SYDNEY CALENDAR DAY, not a UTC one. An inspection finishing at
 * 8pm Tuesday in Sydney is 09:00 UTC that Tuesday, but one at 11am Wednesday is
 * 01:00 UTC Wednesday — a naive UTC date would either file a late Tuesday and an
 * early Wednesday under one date, or split one evening's work across two. Either
 * way the count is wrong, and the count IS the money.
 *
 * CLAIMED, NOT DERIVED. This module says which days EARN an allowance; the
 * caller records the claim in `QaDayAllowance`, whose unique constraint on
 * (inspector, day) stops a day being paid twice when it is split across two
 * invoices — the payee excludes one inspection, sends the rest, then bills the
 * last one next fortnight. Deriving alone would pay that Tuesday twice.
 *
 * PURE — no database.
 */

const SYDNEY = "Australia/Sydney";

/** The calendar day an instant falls on, in Sydney. `yyyy-MM-dd`. */
export function sydneyDayKey(instant: Date): string {
  return formatInTimeZone(instant, SYDNEY, "yyyy-MM-dd");
}

/**
 * The distinct Sydney days represented by a set of inspections.
 *
 * Sorted, so an invoice lists travel in the order it happened rather than in
 * whatever order the query returned it.
 */
export function inspectionDays(instants: readonly (Date | null | undefined)[]): string[] {
  const days = new Set<string>();
  for (const instant of instants) {
    if (!instant) continue;
    // An invalid Date formats to "Invalid Date" and would become a day key of
    // its own — one that can never be matched, claimed or released again.
    if (!Number.isFinite(instant.getTime())) continue;
    days.add(sydneyDayKey(instant));
  }
  return Array.from(days).sort();
}

export interface TransportAllowanceLine {
  /** `yyyy-MM-dd` in Sydney. */
  day: string;
  amount: number;
}

/**
 * Which days on this invoice earn an allowance, and what each is worth.
 *
 * `alreadyClaimedDays` are days this inspector has already been paid travel for
 * — `QaDayAllowance` rows that exist and are spent. They are excluded HERE
 * rather than left to fail the unique constraint later, so the invoice a payee
 * previews is the invoice they are paid.
 *
 * A ZERO OR UNSET RATE PRODUCES NOTHING, deliberately: an allowance nobody has
 * configured must not start appearing as $0.00 lines the day this ships.
 */
export function transportAllowanceLines(input: {
  inspectionInstants: readonly (Date | null | undefined)[];
  amountPerDay: number;
  alreadyClaimedDays?: readonly string[];
}): TransportAllowanceLine[] {
  const amount = Number(input.amountPerDay);
  if (!Number.isFinite(amount) || amount <= 0) return [];

  const claimed = new Set(input.alreadyClaimedDays ?? []);
  return inspectionDays(input.inspectionInstants)
    .filter((day) => !claimed.has(day))
    .map((day) => ({ day, amount: Math.round(amount * 100) / 100 }));
}

/** What the whole allowance is worth on this invoice. */
export function transportAllowanceTotal(lines: readonly TransportAllowanceLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
}

/**
 * How the line reads on the invoice.
 *
 * Names the DAY, because "Travel allowance" three times over with no dates is
 * exactly the line a payee queries and an admin cannot answer without opening
 * the database.
 */
export function transportAllowanceDescription(day: string): string {
  return `Travel allowance — ${day}`;
}
