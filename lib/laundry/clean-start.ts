/**
 * When does the clean at a property actually START? Shared answer for the
 * laundry side of the house:
 *  - key-lost scheduling (pickup/drop happen ON the clean day, after this time)
 *  - the route plan-brief deadline check ("drop before the clean starts")
 *
 * Precedence: the job's late-checkout timing rule (admin rule stored in
 * internalNotes — the same rule applyJobTimingRules uses to push startTime),
 * then the job's stored startTime, then the property's default checkout time,
 * then 10:00 — Airbnb checkouts are 10am unless told otherwise.
 */
import { parseJobInternalNotes, resolveRuleTime } from "@/lib/jobs/meta";

const DEFAULT_CLEAN_START = "10:00";
const KEY_LOST_LATE_CHECKOUT_TIME = "12:30";

type CleanStartJob = {
  startTime?: string | null;
  internalNotes?: string | null;
};

type CleanStartProperty = {
  defaultCheckoutTime?: string | null;
};

function isHHmm(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** True when the job has an enabled late-checkout timing rule. */
export function hasLateCheckout(job: CleanStartJob): boolean {
  const meta = parseJobInternalNotes(job.internalNotes);
  return Boolean(meta.lateCheckout?.enabled && resolveRuleTime(meta.lateCheckout));
}

/** "HH:mm" the clean is expected to start (property-local). */
export function resolveCleanStart(job: CleanStartJob, property?: CleanStartProperty | null): string {
  const meta = parseJobInternalNotes(job.internalNotes);
  const late = meta.lateCheckout?.enabled ? resolveRuleTime(meta.lateCheckout) : undefined;
  if (isHHmm(late)) return late;
  if (isHHmm(job.startTime)) return job.startTime;
  if (isHHmm(property?.defaultCheckoutTime)) return property!.defaultCheckoutTime as string;
  return DEFAULT_CLEAN_START;
}

/**
 * "HH:mm" a key-lost pickup/drop should be scheduled at: after the clean has
 * started — 12:30 when the job has a late checkout, else 10:00 (the user's
 * specified rule, deliberately NOT the raw clean-start time).
 */
export function resolveKeyLostServiceTime(job: CleanStartJob): string {
  return hasLateCheckout(job) ? KEY_LOST_LATE_CHECKOUT_TIME : DEFAULT_CLEAN_START;
}

/**
 * Apply "HH:mm" to a day, returning a new Date at that LOCAL wall-clock time.
 *
 * Deliberately local (setHours, not setUTCHours): the laundry planner
 * normalizes every task date with date-fns `startOfDay` (server-local
 * midnight, and the server runs in Australia/Sydney), and the boards render
 * task times with date-fns `format(..., "HH:mm")` (also local). Using UTC
 * here would make a stored "10:00" render as 20:00/21:00 on the boards.
 */
export function atTimeOnDay(day: Date, hhmm: string): Date {
  const [h, m] = (isHHmm(hhmm) ? hhmm : DEFAULT_CLEAN_START).split(":").map(Number);
  const next = new Date(day);
  next.setHours(h, m, 0, 0);
  return next;
}
