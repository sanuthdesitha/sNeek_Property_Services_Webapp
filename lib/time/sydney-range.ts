import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/**
 * Australia/Sydney calendar-day range helpers.
 *
 * The whole app renders dates in Australia/Sydney, so reporting/finance date
 * ranges must be bucketed by the Sydney calendar day too — otherwise a job that
 * happens near midnight lands in a different period than the date the UI shows
 * (e.g. finance bucketed a drop-off by UTC day while the invoice printed the
 * Sydney date, so the two never reconciled at week/month boundaries).
 *
 * All boundaries are built from Sydney wall-clock strings via fromZonedTime, so
 * they stay correct across daylight-saving transitions.
 */
export const SYDNEY_TZ = "Australia/Sydney";

/** Absolute Date for the start (00:00:00.000) of a yyyy-MM-dd Sydney day. */
export function sydneyDayStart(dateKey: string): Date {
  return fromZonedTime(`${dateKey}T00:00:00.000`, SYDNEY_TZ);
}

/** Absolute Date for the inclusive end (23:59:59.999) of a yyyy-MM-dd Sydney day. */
export function sydneyDayEndInclusive(dateKey: string): Date {
  return fromZonedTime(`${dateKey}T23:59:59.999`, SYDNEY_TZ);
}

/** Today's Sydney calendar date as yyyy-MM-dd. */
export function sydneyTodayKey(now: Date = new Date()): string {
  return formatInTimeZone(now, SYDNEY_TZ, "yyyy-MM-dd");
}

/** Any absolute Date as its Sydney calendar date (yyyy-MM-dd). */
export function sydneyDateKey(date: Date): string {
  return formatInTimeZone(date, SYDNEY_TZ, "yyyy-MM-dd");
}

// ── Pure calendar arithmetic on yyyy-MM-dd keys (UTC cursor, no tz meaning) ──

function keyParts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

function cursorFromKey(key: string): Date {
  const [y, m, d] = keyParts(key);
  return new Date(Date.UTC(y, m - 1, d));
}

function keyFromCursor(c: Date): string {
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, "0");
  const d = String(c.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** yyyy-MM-dd shifted by n calendar days. */
export function addDaysToKey(key: string, n: number): string {
  const c = cursorFromKey(key);
  c.setUTCDate(c.getUTCDate() + n);
  return keyFromCursor(c);
}

/** Monday (week start) of the week containing the given day. */
export function weekMondayKey(key: string): string {
  const c = cursorFromKey(key);
  const day = c.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  c.setUTCDate(c.getUTCDate() + diff);
  return keyFromCursor(c);
}

export function monthStartKey(key: string): string {
  const [y, m] = keyParts(key);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

export function monthEndKey(key: string): string {
  const [y, m] = keyParts(key);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function yearStartKey(key: string): string {
  return `${keyParts(key)[0]}-01-01`;
}

export function yearEndKey(key: string): string {
  return `${keyParts(key)[0]}-12-31`;
}
