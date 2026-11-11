/**
 * The one period helper for the Quality hub. It replaces the `periodToDays`
 * copies the accountability overview and QA performance routes each carried.
 *
 * Every boundary is an Australia/Sydney calendar day (lib/time/sydney-range):
 * "7 days" is today and the six days before it, in Sydney. The previous period
 * is the same number of days immediately before, and exists only when the
 * current period has a start. A custom range is inclusive of both days; a
 * range with only an end (an old `?to=` link) has no start and no previous
 * period.
 *
 * Pure: no database, safe to import in the browser.
 */
import {
  addDaysToKey,
  sydneyDayStart,
  sydneyTodayKey,
} from "@/lib/time/sydney-range";
import { QUALITY_PERIOD_KEYS, type QualityPeriodKey } from "./types";

export const DEFAULT_PERIOD_KEY: QualityPeriodKey = "30d";
const FIXED_DAYS: Record<Exclude<QualityPeriodKey, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type QualityPeriodInput = {
  period?: string | null;
  from?: string | null;
  to?: string | null;
};

export type PeriodRange = {
  /** First day (yyyy-MM-dd, Sydney), or null for an open start. */
  fromKey: string | null;
  /** Last day, inclusive. */
  toKey: string;
  /** Absolute start (Sydney midnight of fromKey), or null for an open start. */
  start: Date | null;
  /** Absolute end, EXCLUSIVE (Sydney midnight after toKey). */
  end: Date;
  /** Calendar days covered, or null for an open start. */
  days: number | null;
};

export type QualityPeriod = PeriodRange & {
  key: QualityPeriodKey;
  previous: PeriodRange | null;
};

/** A malformed hub query. Routes answer 400 with the message. */
export class QualityQueryError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "QualityQueryError";
  }
}

export function isQualityQueryError(error: unknown): error is QualityQueryError {
  return error instanceof QualityQueryError;
}

function isRealDay(key: string): boolean {
  if (!DAY_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function daysBetweenInclusive(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

/** Build a range from inclusive Sydney day keys. */
export function rangeFromKeys(fromKey: string | null, toKey: string): PeriodRange {
  return {
    fromKey,
    toKey,
    start: fromKey ? sydneyDayStart(fromKey) : null,
    end: sydneyDayStart(addDaysToKey(toKey, 1)),
    days: fromKey ? daysBetweenInclusive(fromKey, toKey) : null,
  };
}

/** The equal-length range immediately before `range`; null without a start. */
export function previousRange(range: PeriodRange): PeriodRange | null {
  if (!range.fromKey || range.days === null) return null;
  const toKey = addDaysToKey(range.fromKey, -1);
  return rangeFromKeys(addDaysToKey(toKey, -(range.days - 1)), toKey);
}

function readDay(raw: string | null | undefined, field: "from" | "to"): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!isRealDay(value)) throw new QualityQueryError(`${field} must be a date in the form yyyy-MM-dd.`);
  return value;
}

/**
 * Resolve the period a request asked for. Unknown period keys and invalid
 * custom ranges are REFUSED, not replaced, so a figure never silently answers
 * a different period than the one on screen.
 */
export function resolveQualityPeriod(input: QualityPeriodInput, now: Date = new Date()): QualityPeriod {
  const rawKey = input.period?.trim() || "";
  const from = readDay(input.from, "from");
  const to = readDay(input.to, "to");
  // A from/to pair without a period key is a custom range (old issue links).
  const key = (rawKey || (from || to ? "custom" : DEFAULT_PERIOD_KEY)) as QualityPeriodKey;
  if (!(QUALITY_PERIOD_KEYS as readonly string[]).includes(key)) {
    throw new QualityQueryError(`Unknown period "${rawKey}". Use 7d, 30d, 90d or custom.`);
  }

  const todayKey = sydneyTodayKey(now);
  if (key !== "custom") {
    const days = FIXED_DAYS[key];
    const range = rangeFromKeys(addDaysToKey(todayKey, -(days - 1)), todayKey);
    return { key, ...range, previous: previousRange(range) };
  }

  if (!from && !to) throw new QualityQueryError("A custom period needs a from or to date.");
  const toKey = to ?? todayKey;
  if (from && from > toKey) throw new QualityQueryError("The period starts after it ends.");
  const range = rangeFromKeys(from, toKey);
  return { key, ...range, previous: previousRange(range) };
}

/** For the browser: an unreadable URL falls back to the default period. */
export function resolveQualityPeriodLenient(input: QualityPeriodInput, now: Date = new Date()): QualityPeriod {
  try {
    return resolveQualityPeriod(input, now);
  } catch {
    return resolveQualityPeriod({ period: DEFAULT_PERIOD_KEY }, now);
  }
}

/**
 * Change of a figure against the previous period, or null when it cannot be
 * stated honestly: no previous period, no data in either period.
 */
export function deltaVsPrevious(
  current: number | null,
  previous: number | null,
  previousSample: number,
): number | null {
  if (current === null || previous === null || previousSample <= 0) return null;
  return Math.round((current - previous) * 10) / 10;
}

/** The period as query parameters (`period`, plus `from`/`to` for custom). */
export function periodQuery(period: Pick<QualityPeriod, "key" | "fromKey" | "toKey">): Record<string, string> {
  if (period.key !== "custom") return { period: period.key };
  return { period: "custom", ...(period.fromKey ? { from: period.fromKey } : {}), to: period.toKey };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "6 Nov" from a day key, without re-entering a timezone. */
export function shortDayLabel(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function periodLabel(period: Pick<QualityPeriod, "key" | "fromKey" | "toKey">): string {
  if (period.key === "7d") return "Last 7 days";
  if (period.key === "30d") return "Last 30 days";
  if (period.key === "90d") return "Last 90 days";
  if (!period.fromKey) return `Up to ${shortDayLabel(period.toKey)}`;
  return `${shortDayLabel(period.fromKey)} – ${shortDayLabel(period.toKey)}`;
}
