/**
 * What a rate change does, in words that match the pay code exactly
 * (lib/accounts/pay-rate explains the code paths). Shown wherever the rate
 * can be changed.
 */
import { MAX_HOURLY_RATE, MIN_HOURLY_RATE } from "@/lib/accounts/pay-rate-rules";

export const RATE_HELP =
  "Applies to jobs on or after the Applies from day that have no rate saved on the job (a rate set at assignment or by job type wins), and to QA inspections with no rate of their own. " +
  `Between $${MIN_HOURLY_RATE} and $${MAX_HOURLY_RATE}.`;

export const APPLIES_FROM_HELP = "Today or a later day. Jobs before it keep the rate in force on their day.";

export const RATE_RECALC_NOTE = "Jobs already paid keep the rate they were paid at.";

/** yyyy-MM-dd → "Mon 16 Nov 2026" (calendar date, never shifted). */
export function formatRateDay(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return key;
  if (key === "1970-01-01") return "Before history";
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
