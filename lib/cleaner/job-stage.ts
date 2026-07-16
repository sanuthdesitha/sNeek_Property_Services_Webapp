/**
 * Pure derivation of the cleaner job "journey" stage from the workspace's
 * existing gate booleans. This is presentation-only sequencing — it never
 * changes any outcome; the workspace still owns every mutation, gate and
 * validation. It exists so the 5-stage UI can pick a sensible *initial* stage
 * and auto-advance on the same transitions that already happen today.
 *
 * The five stages:
 *   1 Accept   — the job is still OFFERED to this cleaner (needsAcceptance).
 *   2 Get there — actively en route to this job (enRouteActive) and not started.
 *   3 Set up    — accepted, not yet clocked in: property setup + the start gate.
 *   4 Clean     — clocked in / work in progress (hasStarted && !locked).
 *   5 Wrap up   — submitted / locked (review) — the terminal state.
 *
 * Ordering rules (documented so callers can reason about edge cases):
 *   • needsAcceptance always wins → 1 (you can't do anything until you accept).
 *   • locked always wins over "started" → 5 (a submitted job is a locked review
 *     even though it also has time logged / has "started").
 *   • hasStarted → 4 (clocked in — the clean is underway).
 *   • otherwise, en route → 2, else the default for an accepted-but-not-started
 *     job is 3 (setup). We deliberately do NOT force travel: absence of arrival
 *     alone keeps you on Set up, so a cleaner already at the door isn't pushed
 *     back to a travel screen. Stage 2 shows only while actively en route.
 *
 * `arrived` and `formComplete` are part of the input shape for callers that want
 * to reason about them (e.g. badge ticks / reachability), but the minimal stage
 * derivation does not branch on them — arrival simply means "not en route", and
 * completion is surfaced through `locked` (submit) rather than a separate stage.
 */
export type JobStage = 1 | 2 | 3 | 4 | 5;

export interface JobStageInput {
  /** This cleaner's own assignment is still PENDING (offered, not accepted). */
  needsAcceptance: boolean;
  /** Clocked in — a GPS check-in exists, the clock is running, or time is banked. */
  hasStarted: boolean;
  /** Submitted / QA / completed / invoiced — the workspace is read-only. */
  locked: boolean;
  /** Actively driving/walking/riding to THIS job (en route, not yet arrived). */
  enRouteActive: boolean;
  /** Marked as arrived at the property (informational; not a branch today). */
  arrived: boolean;
  /** Every required form item is satisfied (informational; not a branch today). */
  formComplete: boolean;
}

export function deriveJobStage(s: JobStageInput): JobStage {
  if (s.needsAcceptance) return 1;
  if (s.locked) return 5;
  if (s.hasStarted) return 4;
  if (s.enRouteActive) return 2;
  return 3;
}

/** Human labels for the journey rail (index by stage number). */
export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  1: "Accept",
  2: "Get there",
  3: "Set up",
  4: "Clean",
  5: "Wrap up",
};
