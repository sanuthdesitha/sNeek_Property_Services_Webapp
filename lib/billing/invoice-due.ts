/**
 * The due day of a client invoice: created + payment terms, read as a calendar
 * day in the organisation timezone. The list, the overdue filter, the editor
 * and the PDF all use this one function, so the day a client reads on the
 * document is the day the office sees as due.
 *
 * Pure: safe for client components and tests.
 */
import { formatInTimeZone } from "date-fns-tz";

export const FALLBACK_PAYMENT_TERMS_DAYS = 14;
export const FALLBACK_INVOICE_TIMEZONE = "Australia/Sydney";

const DAY_MS = 86_400_000;

/** Configured terms, or the fallback when none (or nonsense) is configured. */
export function paymentTermsDaysFrom(configured: unknown): number {
  return typeof configured === "number" && Number.isFinite(configured) && configured >= 0
    ? configured
    : FALLBACK_PAYMENT_TERMS_DAYS;
}

/** The due day as yyyy-MM-dd in the organisation timezone. */
export function invoiceDueDay(createdAt: Date | string, termsDays: number, timezone: string | null | undefined): string {
  const dueAt = new Date(new Date(createdAt).getTime() + termsDays * DAY_MS);
  return formatInTimeZone(dueAt, timezone || FALLBACK_INVOICE_TIMEZONE, "yyyy-MM-dd");
}

/** A yyyy-MM-dd day printed as "dd MMM yyyy" with no timezone shift. */
export function printCalendarDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date).padStart(2, "0")} ${names[month - 1]} ${year}`;
}
