/**
 * What a rate change does, in words that match the pay code exactly
 * (lib/accounts/pay-rate explains the code paths). Shown wherever the rate
 * can be changed.
 */
import { MAX_HOURLY_RATE, MIN_HOURLY_RATE } from "@/lib/accounts/pay-rate-rules";

export const RATE_HELP =
  "Applies from now to pay worked out for jobs with no rate saved on the job (a rate set at assignment or by job type wins), and to QA inspections with no rate of their own. " +
  "Payroll runs, cleaner invoices and settled pay already created keep their saved amounts. " +
  `Between $${MIN_HOURLY_RATE} and $${MAX_HOURLY_RATE}.`;

export const RATE_RECALC_NOTE =
  "Screens that recalculate a past job without a saved rate (job pay summary, finance estimates) will show the new rate; amounts already paid do not change.";
