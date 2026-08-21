import { JobStatus } from "@prisma/client";

/**
 * The job statuses during which a cleaner's location is tracked.
 *
 * This list existed in four places — the per-job ping route, the active-job
 * poll the cleaner app uses to decide whether to run its GPS watch, and both
 * admin ops readers — and one of the four was wrong. The ping route accepted
 * `EN_ROUTE` only, so the moment a cleaner checked in the server began
 * rejecting their fixes; the client kept a live GPS watch running against an
 * endpoint that refused everything, and cleared its queue on the 400.
 *
 * Nobody noticed because the READERS were correct. They asked for on-site
 * cleaners and got nothing back, which presents as "no signal" rather than as
 * a bug — the failure looked like weak reception, so it was lived with.
 *
 * So the window lives here once: the whole time the cleaner is engaged with the
 * job — driving to it, working on it, or paused mid-clean — ending when the job
 * leaves that window (submitted, completed, cancelled).
 *
 * PAUSED is in the list deliberately. A paused job is a cleaner who stepped out
 * for supplies or a break; ops still needs to know where they are, and dropping
 * them off the map is how somebody gets marked missing for an hour.
 */
export const TRACKED_STATUSES: JobStatus[] = [
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

export function isTrackedStatus(status: JobStatus | string): boolean {
  return (TRACKED_STATUSES as string[]).includes(status);
}
