/**
 * Organisation-timezone helpers for the website, blog and marketing editors.
 * Plain module (safe for server pages and client components).
 *
 * A publish or send time is typed as a wall-clock time in the organisation's
 * timezone (Sydney), whatever the browser's own timezone is, and stored as an
 * instant. History is shown in the same timezone.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_ORG_TIMEZONE = "Australia/Sydney";

/** "2026-12-01T07:00" (organisation wall clock) → ISO instant, or null when blank/invalid. */
export function zonedInputToIso(value: string, timeZone: string = DEFAULT_ORG_TIMEZONE): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return null;
  const instant = fromZonedTime(trimmed, timeZone);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
}

/** ISO instant → "2026-12-01T07:00" in the organisation timezone ("" when blank/invalid). */
export function isoToZonedInput(value: string | Date | null | undefined, timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd'T'HH:mm");
}

/** "Tue 1 Dec 07:00" in the organisation timezone; "" when unknown. */
export function formatOrgDateTime(value: string | Date | null | undefined, timeZone: string = DEFAULT_ORG_TIMEZONE): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return formatInTimeZone(date, timeZone, "EEE d MMM HH:mm");
}

/** "28 Oct" (adds the year when it is not this year); "" when unknown. */
export function formatOrgDay(value: string | Date | null | undefined, timeZone: string = DEFAULT_ORG_TIMEZONE, now: Date = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const sameYear = formatInTimeZone(date, timeZone, "yyyy") === formatInTimeZone(now, timeZone, "yyyy");
  return formatInTimeZone(date, timeZone, sameYear ? "d MMM" : "d MMM yyyy");
}

/** True when the instant falls on today's date in the organisation timezone. */
export function isOrgToday(value: string | Date, timeZone: string = DEFAULT_ORG_TIMEZONE, now: Date = new Date()): boolean {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd") === formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}
