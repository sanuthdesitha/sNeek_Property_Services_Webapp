/**
 * Where a job sits on the client-facing progress bar.
 *
 * The bar showed eight steps and looked the status up with `indexOf`. Three of
 * the eleven JobStatus members are not on that ladder — OFFERED, PAUSED and
 * WAITING_CONTINUATION_APPROVAL — so `indexOf` returned -1, and the fallback
 * `-1 → 0` drew the job as UNASSIGNED. A client whose clean was paused mid-way
 * saw a timeline claiming nobody had been assigned yet. Not a missing step: a
 * wrong one.
 *
 * The fix is NOT to add them as steps. A paused job has not moved past
 * in-progress and has not gone backwards either — it is at the same place on
 * the ladder, in a different condition. Adding "Paused" as a ninth step would
 * imply a job passes through it on the way to finishing, which is false.
 *
 * So each off-ladder status maps to the step it is actually at, plus a note
 * saying what is happening there.
 */

/** The visible progression, in order. */
export const CLIENT_TIMELINE_STEPS = [
  "UNASSIGNED",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
] as const;

export type ClientTimelineStep = (typeof CLIENT_TIMELINE_STEPS)[number];

/**
 * Statuses that are a condition at a step rather than a step of their own.
 * The note is client-facing: it says what is happening, not what the enum is.
 */
const OFF_LADDER: Record<string, { at: ClientTimelineStep; note: string }> = {
  // Offered to a cleaner but not yet accepted — nobody has committed, so it
  // sits at the start of the ladder rather than at "Assigned".
  OFFERED: { at: "UNASSIGNED", note: "Offered to a cleaner" },
  PAUSED: { at: "IN_PROGRESS", note: "Paused" },
  WAITING_CONTINUATION_APPROVAL: {
    at: "IN_PROGRESS",
    note: "Paused — waiting on approval to continue",
  },
};

export interface ClientTimelinePosition {
  /** Index into CLIENT_TIMELINE_STEPS. Never -1. */
  index: number;
  /** Set when the job is in a condition the ladder cannot show by position. */
  note: string | null;
  /** True when the status was not recognised at all. */
  unknown: boolean;
}

export function resolveClientTimelinePosition(status: string): ClientTimelinePosition {
  const direct = CLIENT_TIMELINE_STEPS.indexOf(status as ClientTimelineStep);
  if (direct !== -1) return { index: direct, note: null, unknown: false };

  const mapped = OFF_LADDER[status];
  if (mapped) {
    return {
      index: CLIENT_TIMELINE_STEPS.indexOf(mapped.at),
      note: mapped.note,
      unknown: false,
    };
  }

  // A status added later and not mapped here. Falling back to step 0 is what
  // caused the original bug, so this reports itself as unknown and lets the
  // caller show the position as indeterminate rather than confidently wrong.
  return { index: 0, note: null, unknown: true };
}
