/**
 * The Insights period. Built on the Quality hub's period helper
 * (lib/quality/period.ts): the same Australia/Sydney calendar days, the same
 * inclusive-day ranges (`rangeFromKeys`) and, for a custom range, the same
 * "previous equal period" (`previousRange`: the same number of days
 * immediately before). The calendar presets add month and quarter logic:
 *
 *   this-month  1st of the current month → today.
 *               Previous: the same days of the month before (1st → same day,
 *               clamped to that month's last day).
 *   last-month  The whole previous calendar month.
 *               Previous: the whole calendar month before that.
 *   quarter     1st of the current calendar quarter → today (quarter to date).
 *               Previous: the same number of days from the 1st of the previous
 *               quarter, clamped to that quarter's last day.
 *   custom      Inclusive from/to days, at most MAX_PERIOD_DAYS long.
 *               Previous: Quality's equal-length range immediately before.
 *
 * Pure: no database, safe to import in the browser.
 */
import { addDaysToKey, monthEndKey, monthStartKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import { previousRange, rangeFromKeys, shortDayLabel, type PeriodRange } from "@/lib/quality/period";
import { INSIGHTS_PERIOD_KEYS, type InsightsPeriodKey, type PeriodPayload } from "./types";

export const DEFAULT_INSIGHTS_PERIOD: InsightsPeriodKey = "last-month";
/** A period longer than this is refused, which bounds every query. */
export const MAX_PERIOD_DAYS = 366;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A closed range: Insights periods always have a first day. */
export type ClosedRange = PeriodRange & { fromKey: string; start: Date; days: number };

export type InsightsPeriod = ClosedRange & {
  key: InsightsPeriodKey;
  previous: ClosedRange | null;
};

export type InsightsPeriodInput = { period?: string | null; from?: string | null; to?: string | null };

export class InsightsQueryError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "InsightsQueryError";
  }
}

export function isInsightsQueryError(error: unknown): error is InsightsQueryError {
  return error instanceof InsightsQueryError;
}

function closed(range: PeriodRange): ClosedRange {
  if (!range.fromKey || !range.start || range.days === null) {
    throw new InsightsQueryError("A period needs a first day.");
  }
  return range as ClosedRange;
}

function closedRange(fromKey: string, toKey: string): ClosedRange {
  return closed(rangeFromKeys(fromKey, toKey));
}

function isRealDay(key: string): boolean {
  if (!DAY_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function readDay(raw: string | null | undefined, field: "from" | "to"): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!isRealDay(value)) throw new InsightsQueryError(`${field} must be a date in the form yyyy-MM-dd.`);
  return value;
}

function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/** First day of the month before the month containing `key`. */
function previousMonthStart(key: string): string {
  return monthStartKey(addDaysToKey(monthStartKey(key), -1));
}

function quarterStartKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const firstMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(firstMonth).padStart(2, "0")}-01`;
}

function quarterEndKey(startKey: string): string {
  const [y, m] = startKey.split("-").map(Number);
  const lastMonth = m + 2;
  return monthEndKey(`${y}-${String(lastMonth).padStart(2, "0")}-01`);
}

function thisMonth(todayKey: string): { range: ClosedRange; previous: ClosedRange } {
  const range = closedRange(monthStartKey(todayKey), todayKey);
  const prevStart = previousMonthStart(todayKey);
  const prevEnd = earlier(addDaysToKey(prevStart, range.days - 1), monthEndKey(prevStart));
  return { range, previous: closedRange(prevStart, prevEnd) };
}

function lastMonth(todayKey: string): { range: ClosedRange; previous: ClosedRange } {
  const start = previousMonthStart(todayKey);
  const range = closedRange(start, monthEndKey(start));
  const prevStart = previousMonthStart(start);
  return { range, previous: closedRange(prevStart, monthEndKey(prevStart)) };
}

function quarterToDate(todayKey: string): { range: ClosedRange; previous: ClosedRange } {
  const start = quarterStartKey(todayKey);
  const range = closedRange(start, todayKey);
  const prevStart = quarterStartKey(addDaysToKey(start, -1));
  const prevEnd = earlier(addDaysToKey(prevStart, range.days - 1), quarterEndKey(prevStart));
  return { range, previous: closedRange(prevStart, prevEnd) };
}

/**
 * Resolve the period a request asked for. Unknown keys, malformed or reversed
 * days and over-long ranges are REFUSED, never replaced, so a figure never
 * answers a different period than the one on screen.
 */
export function resolveInsightsPeriod(input: InsightsPeriodInput, now: Date = new Date()): InsightsPeriod {
  const rawKey = input.period?.trim() || "";
  const from = readDay(input.from, "from");
  const to = readDay(input.to, "to");
  const key = (rawKey || (from || to ? "custom" : DEFAULT_INSIGHTS_PERIOD)) as InsightsPeriodKey;
  if (!(INSIGHTS_PERIOD_KEYS as readonly string[]).includes(key)) {
    throw new InsightsQueryError(`Unknown period "${rawKey}". Use this-month, last-month, quarter or custom.`);
  }
  const todayKey = sydneyTodayKey(now);
  const presets = { "this-month": thisMonth, "last-month": lastMonth, quarter: quarterToDate } as const;
  if (key !== "custom") {
    const { range, previous } = presets[key](todayKey);
    return { key, ...range, previous };
  }

  if (!from || !to) throw new InsightsQueryError("A custom period needs both a from and a to date.");
  if (from > to) throw new InsightsQueryError("The period starts after it ends.");
  const range = closedRange(from, to);
  if (range.days > MAX_PERIOD_DAYS) {
    throw new InsightsQueryError(`A period can be at most ${MAX_PERIOD_DAYS} days long.`);
  }
  const previous = previousRange(range);
  return { key, ...range, previous: previous ? closed(previous) : null };
}

/** For the browser: an unreadable URL falls back to the default period. */
export function resolveInsightsPeriodLenient(input: InsightsPeriodInput, now: Date = new Date()): InsightsPeriod {
  try {
    return resolveInsightsPeriod(input, now);
  } catch {
    return resolveInsightsPeriod({ period: DEFAULT_INSIGHTS_PERIOD }, now);
  }
}

/** The period as query parameters (`period`, plus `from`/`to` for custom). */
export function insightsPeriodQuery(period: Pick<InsightsPeriod, "key" | "fromKey" | "toKey">): Record<string, string> {
  if (period.key !== "custom") return { period: period.key };
  return { period: "custom", from: period.fromKey, to: period.toKey };
}

function yearOf(key: string): string {
  return key.slice(0, 4);
}

/** "October 2026" for a whole month, else "1 – 11 Nov 2026". */
export function rangeLabel(range: Pick<ClosedRange, "fromKey" | "toKey">): string {
  const { fromKey, toKey } = range;
  if (fromKey === monthStartKey(fromKey) && toKey === monthEndKey(fromKey)) {
    return `${MONTH_NAMES[Number(fromKey.slice(5, 7)) - 1]} ${yearOf(fromKey)}`;
  }
  const sameYear = yearOf(fromKey) === yearOf(toKey);
  const fromText = sameYear ? shortDayLabel(fromKey) : `${shortDayLabel(fromKey)} ${yearOf(fromKey)}`;
  return `${fromText} – ${shortDayLabel(toKey)} ${yearOf(toKey)}`;
}

export function periodPayload(period: InsightsPeriod): PeriodPayload {
  return {
    key: period.key,
    fromKey: period.fromKey,
    toKey: period.toKey,
    days: period.days,
    label: rangeLabel(period),
    previous: period.previous
      ? { fromKey: period.previous.fromKey, toKey: period.previous.toKey, label: rangeLabel(period.previous) }
      : null,
  };
}

/** True when `date` falls inside the range (end exclusive). */
export function inRange(date: Date, range: Pick<ClosedRange, "start" | "end">): boolean {
  return date >= range.start && date < range.end;
}
