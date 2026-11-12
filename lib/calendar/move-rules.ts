/**
 * Which jobs the calendar offers to move (drag, or "Move or reassign…").
 *
 * This is a calendar presentation rule, not a scheduling rule: the reschedule
 * service (`applyReschedule`) and the assign route keep their own checks and
 * are not changed. The calendar simply does not offer a drag for work that has
 * started or finished, a skipped clean, or a draft; the job's Schedule and
 * People tabs remain the place for deliberate corrections.
 */
export const CALENDAR_FROZEN_STATUS_REASONS: Readonly<Record<string, string>> = {
  EN_ROUTE: "The cleaner is on the way to this job.",
  IN_PROGRESS: "Work on this job has started.",
  PAUSED: "Work on this job has started and is paused.",
  WAITING_CONTINUATION_APPROVAL: "Work on this job has started and is waiting for approval.",
  SUBMITTED: "This clean has been submitted.",
  QA_REVIEW: "This clean is in QA review.",
  COMPLETED: "This job is completed.",
  INVOICED: "This job is invoiced.",
};

export type MoveRuleInput = { status: string; skipped: boolean; isDraft: boolean };

/** A sentence saying why the calendar will not move this job, or null. */
export function calendarMoveBlock(input: MoveRuleInput): string | null {
  if (input.isDraft) return "This is a draft job. Publish it before scheduling it.";
  if (input.status === "CANCELLED") return "This job is cancelled. Restore it from the job before moving it.";
  const frozen = CALENDAR_FROZEN_STATUS_REASONS[input.status];
  if (frozen) return `${frozen} It cannot be moved from the calendar; use the job's Schedule tab if a correction is needed.`;
  if (input.skipped) return "This clean is skipped. Un-skip it on the job's Schedule tab before moving it.";
  return null;
}
