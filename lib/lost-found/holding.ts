/**
 * Lost and found holding period (owner decision 2026-11-11: 14 days).
 *
 * Days are counted in the organisation's calendar (Australia/Sydney by
 * default), from the day the item was found to today: an item found on the
 * 1st is "14 days" on the 15th and past a 14-day holding period on the 16th.
 * Only items in storage or awaiting the guest count. This flags; it never
 * disposes, donates or changes anything by itself. Pure.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { HOLDING_STATUSES } from "./status";

export const DEFAULT_HOLDING_DAYS = 14;
export const MAX_HOLDING_DAYS = 365;

const DAY_MS = 86_400_000;

function calendarDay(at: Date, timeZone: string): string {
  return formatInTimeZone(at, timeZone, "yyyy-MM-dd");
}

/** Whole calendar days between two instants, in `timeZone`. */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  const start = Date.parse(`${calendarDay(from, timeZone)}T00:00:00Z`);
  const end = Date.parse(`${calendarDay(to, timeZone)}T00:00:00Z`);
  return Math.round((end - start) / DAY_MS);
}

export type HoldingState = {
  /** The status counts toward holding (in storage or awaiting the guest). */
  counts: boolean;
  /** Calendar days since found; null when the status does not count. */
  days: number | null;
  /** Held longer than the holding period. */
  past: boolean;
};

export function holdingState(input: { status: string; foundAt: Date; now: Date; timeZone: string; holdingDays: number }): HoldingState {
  const counts = (HOLDING_STATUSES as string[]).includes(input.status);
  if (!counts) return { counts: false, days: null, past: false };
  const days = calendarDaysBetween(input.foundAt, input.now, input.timeZone);
  return { counts: true, days, past: days > input.holdingDays };
}

/**
 * Items found before this instant are past the holding period today
 * (`createdAt < cutoff` ⇔ days since found > holdingDays). For server filters.
 */
export function holdingCutoff(now: Date, timeZone: string, holdingDays: number): Date {
  const today = Date.parse(`${calendarDay(now, timeZone)}T00:00:00Z`);
  const firstUnflaggedDay = new Date(today - holdingDays * DAY_MS).toISOString().slice(0, 10);
  return fromZonedTime(`${firstUnflaggedDay}T00:00:00`, timeZone);
}

/**
 * Owner decision seven (Wave F): an item still at "New" (REPORTED, not yet
 * processed) is flagged once it was found more than this many days ago,
 * counted from the found date like the holding period. A named threshold,
 * separate from the configurable holding period; it flags only.
 */
export const NEW_ITEM_FLAG_DAYS = 14;

export type UnprocessedFlag = { days: number } | null;

/** The flag for an item still at New, or null (any other status, or not old enough). */
export function unprocessedNewFlag(input: { status: string; foundAt: Date; now: Date; timeZone: string }): UnprocessedFlag {
  if (input.status !== "REPORTED") return null;
  const days = calendarDaysBetween(input.foundAt, input.now, input.timeZone);
  return days > NEW_ITEM_FLAG_DAYS ? { days } : null;
}

/** Items found before this instant and still at New are flagged today. */
export function unprocessedNewCutoff(now: Date, timeZone: string): Date {
  return holdingCutoff(now, timeZone, NEW_ITEM_FLAG_DAYS);
}

/** A calendar date (YYYY-MM-DD) in `timeZone` as the instant its day starts or ends. */
export function zonedDayBoundary(day: string, timeZone: string, edge: "start" | "end"): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = fromZonedTime(`${day}T00:00:00`, timeZone);
  if (!Number.isFinite(start.getTime())) return null;
  if (edge === "start") return start;
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return new Date(fromZonedTime(`${next}T00:00:00`, timeZone).getTime() - 1);
}
