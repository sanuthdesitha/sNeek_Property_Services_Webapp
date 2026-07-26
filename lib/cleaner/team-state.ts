/**
 * Team vs own start state for a cleaner job.
 *
 * A job can have MULTIPLE cleaners assigned. Two different questions get asked
 * about "has this started?", and conflating them is what broke the second
 * cleaner:
 *
 *  - VISIBILITY ("can I see the checklist / reach the Clean stage?") — true as
 *    soon as ANYONE on the team has started, because the clean is underway and
 *    the second cleaner must be able to work.
 *  - OWN TIME ("has MY clock started?") — strictly per-cleaner, because pay and
 *    timesheets are personal. The second cleaner still has to clock in.
 *
 * Previously `hasStarted` was own-only (own timeLogs + the job-global
 * `gpsCheckInAt` scalar), so when cleaner A started, cleaner B was pinned on
 * Set-up behind "complete the start verification" even though the job was
 * IN_PROGRESS. This module is the single source of truth for both questions.
 */

/** Job statuses that mean the clean is actively underway. */
export const TEAM_ACTIVE_STATUSES = ["IN_PROGRESS", "PAUSED"] as const;

export interface TeamStateInput {
  /** Job.status */
  jobStatus?: string | null;
  /** True when ANY assignment on this job has a time log (any cleaner). */
  anyTeamTimeLog?: boolean;
  /** This cleaner's own timer is running. */
  ownRunning?: boolean;
  /** This cleaner's own recorded seconds. */
  ownCompletedSeconds?: number | null;
}

/** The clean is underway for the TEAM (someone started). */
export function isTeamStarted(input: TeamStateInput): boolean {
  const status = String(input.jobStatus ?? "");
  if ((TEAM_ACTIVE_STATUSES as readonly string[]).includes(status)) return true;
  return input.anyTeamTimeLog === true;
}

/**
 * The clean is underway RIGHT NOW — i.e. the job itself is in an active status
 * AND someone is on the clock.
 *
 * This is deliberately narrower than `isTeamStarted`, which also returns true
 * from a *stale* team time log. That distinction is what fixes the reassignment
 * deadlock: when an admin moves a started job back to ASSIGNED and hands it to
 * a new cleaner, the old time log (and the immutable job-level `gpsCheckInAt`)
 * still exist, so `isTeamStarted` stays true — the workspace concluded the job
 * was already started and never rendered the start verification, while the
 * server's own gate (keyed on the CURRENT cleaner's TimeLog) kept rejecting the
 * clock-in with JOB_START_CONFIRMATION_REQUIRED. Unstartable, unsubmittable.
 */
export function isTeamActive(input: TeamStateInput): boolean {
  const status = String(input.jobStatus ?? "");
  if (!(TEAM_ACTIVE_STATUSES as readonly string[]).includes(status)) return false;
  return input.anyTeamTimeLog === true || isOwnStarted(input);
}

/** THIS cleaner has clocked in at some point (drives pay/time, never visibility). */
export function isOwnStarted(input: TeamStateInput): boolean {
  return input.ownRunning === true || (input.ownCompletedSeconds ?? 0) > 0;
}

/**
 * Whether the checklist / Clean + Wrap-up stages should be reachable.
 * Own start OR team start — deliberately NOT gated on this cleaner's own clock.
 */
export function isStartedForVisibility(input: TeamStateInput): boolean {
  return isOwnStarted(input) || isTeamStarted(input);
}

/**
 * Whether the heavyweight "before you start" confirmations (property code,
 * laundry bag) must be completed. Only the FIRST person to start the job does
 * these — a second cleaner joining an in-progress clean shouldn't be forced to
 * re-confirm the property code that's already been verified.
 *
 * Keyed on `isTeamActive`, NOT `isTeamStarted`: a stale artifact from a previous
 * cleaner (time log, gpsCheckInAt) on a job that has since been moved back to
 * ASSIGNED must not suppress the gate for the new assignee. The server's start
 * route requires the confirmations from anyone with no time log of their own, so
 * the UI has to key off the same "is this MY first start on a job that isn't
 * currently running?" question or clock-in becomes impossible.
 *
 * `hasJobCheckIn` (the job-level, immutable Job.gpsCheckInAt) is accepted but
 * deliberately NOT treated as a bypass — it belongs to whoever arrived first,
 * which may no longer be this cleaner.
 */
export function requiresStartConfirmations(
  input: TeamStateInput & {
    requireStartConfirmation?: boolean;
    locked?: boolean;
    needsAcceptance?: boolean;
    hasJobCheckIn?: boolean;
  },
): boolean {
  if (input.requireStartConfirmation === false) return false;
  if (input.locked || input.needsAcceptance) return false;
  if (isOwnStarted(input)) return false; // I've already started
  if (isTeamActive(input)) return false; // clean underway now — first starter already confirmed
  return true;
}
