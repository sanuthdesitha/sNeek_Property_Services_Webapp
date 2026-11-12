/**
 * Dates on the quote page: history instants in the organisation timezone;
 * a valid-until day stays the stored calendar day. Plain module.
 */
import { formatInTimeZone } from "date-fns-tz";

function valid(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatOrgDate(iso: string | null | undefined, timezone: string): string {
  const date = valid(iso);
  return date ? formatInTimeZone(date, timezone, "EEE d MMM") : "";
}

export function formatOrgDateTime(iso: string | null | undefined, timezone: string): string {
  const date = valid(iso);
  return date ? formatInTimeZone(date, timezone, "d MMM yyyy, h:mm a") : "";
}

/** "YYYY-MM-DD" (the builder's valid-until value) as "Mon 23 Nov", without a timezone shift. */
export function formatCalendarDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return formatInTimeZone(date, "UTC", "EEE d MMM");
}

/** Whole days from today (in the organisation timezone) to a calendar day; negative when past. */
export function daysUntil(day: string, timezone: string, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const [y, m, d] = today.split("-").map(Number);
  const from = Date.UTC(y, m - 1, d);
  const to = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((to - from) / 86_400_000);
}
