/**
 * Date display for People screens. History instants are shown in the
 * organisation timezone; calendar days (yyyy-MM-dd) are printed as they are,
 * never shifted. Plain module.
 */
import { formatInTimeZone } from "date-fns-tz";
import { ORG_TIME_ZONE } from "@/components/v2/admin/accounts/hub/account-display";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-03" → "3 Nov 2026" (no timezone involved). */
export function formatCalendarDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** An instant as "12 Nov 2026, 09:24" in the organisation timezone. */
export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return "–";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "–" : formatInTimeZone(date, ORG_TIME_ZONE, "d MMM yyyy, HH:mm");
}

/** An instant's day as "12 Nov 2026" in the organisation timezone. */
export function formatInstantDay(iso: string | null | undefined): string {
  if (!iso) return "–";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "–" : formatInTimeZone(date, ORG_TIME_ZONE, "d MMM yyyy");
}

/** "14 days, client's own terms" / "7 days, organisation default". */
export function termsLabel(terms: { days: number; source: "CLIENT" | "DEFAULT" }): string {
  return `${terms.days} days${terms.source === "CLIENT" ? ", client's own terms" : ", organisation default"}`;
}
