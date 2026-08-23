import { JobType } from "@prisma/client";
import { resolveJobCleanHours } from "@/lib/properties/clean-hours";

/**
 * Display + accountability helpers for a job's start window and expected
 * duration. Pure functions — no DB, no side effects. Used to surface "when to
 * start / finish" and "how long this should take" without any auto-planning.
 */

type JobLike = {
  jobType: JobType | string;
  startTime?: string | null;
  dueTime?: string | null;
  estimatedHours?: number | null;
};

type PropertyLike = {
  defaultCheckoutTime?: string | null;
  defaultCheckinTime?: string | null;
  cleaningDurationMinutes?: number | null;
  assignedCleaningHours?: number | null;
  /** Optional: callers that select it get the legacy hours considered too. */
  accessInfo?: unknown;
};

/**
 * A human-readable start window for a job.
 *
 * For AIRBNB_TURNOVER: a window bounded by the earliest start (job.startTime,
 * else the property's default checkout time, else "10:00") and the latest
 * finish (job.dueTime, else the property's default check-in time, else "15:00"),
 * e.g. "Start after 10:00 · finish before 15:00".
 *
 * For every other job type: the plain start time, or null when none is set.
 */
export function formatStartWindow(job: JobLike, property: PropertyLike): string | null {
  if (job.jobType === JobType.AIRBNB_TURNOVER) {
    const start = job.startTime || property.defaultCheckoutTime || "10:00";
    const finish = job.dueTime || property.defaultCheckinTime || "15:00";
    return `Start after ${start} · finish before ${finish}`;
  }
  return job.startTime || null;
}

/**
 * The expected hours a job should take. Read by accountability / clock rules
 * that compare actual against expected.
 *
 * Delegates to the shared property rule rather than carrying its own. The old
 * version here never consulted `accessInfo.defaultCleanDurationHours`, so a
 * property holding only that legacy value reported NO expected hours — and an
 * accountability check with nothing to compare against silently stops checking.
 * The doc comment was also stale, still describing a precedence the code had
 * already stopped using.
 */
export function resolveExpectedHours(job: JobLike, property: PropertyLike): number | null {
  return resolveJobCleanHours(job, property);
}
