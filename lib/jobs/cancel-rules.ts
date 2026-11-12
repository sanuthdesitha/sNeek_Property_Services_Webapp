/**
 * "Cancel job" rules (Wave E, 2026-11). Pure and dependency-light, so screens,
 * services and tests share one copy. The server service is ./cancel.ts.
 *
 * Who and when:
 *  - Unstarted (Unassigned, Awaiting confirmation, Assigned): ADMIN, or an
 *    OPS_MANAGER whose Jobs pack allows changes (the route's guard).
 *  - Started (on the way, in progress, paused, waiting approval, submitted,
 *    in QA, completed): ADMIN only, with a reason; time logs and evidence are
 *    kept exactly as they are.
 *  - Never: Invoiced (the invoice decides), or already Cancelled.
 * A reason is always required.
 *
 * Restore returns a job to the unstarted status it was cancelled from; a job
 * cancelled after it started is not restored (its work record stays as it
 * was) — create a new job instead.
 */
import { JobStatus } from "@prisma/client";

export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 1000;

export const UNSTARTED_JOB_STATUSES: readonly JobStatus[] = [JobStatus.UNASSIGNED, JobStatus.OFFERED, JobStatus.ASSIGNED];

export const STARTED_CANCELLABLE_STATUSES: readonly JobStatus[] = [
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
];

/** Statuses that are finished or cancelled: never "open" work. */
export const CLOSED_JOB_STATUSES: readonly JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED, JobStatus.CANCELLED];

/** Prisma filter: the job is not cancelled. */
export const NOT_CANCELLED_JOB_WHERE = { status: { not: JobStatus.CANCELLED } } as const;

export function isCancelledStatus(status: string | null | undefined): boolean {
  return status === JobStatus.CANCELLED;
}

export function isUnstartedStatus(status: string | null | undefined): boolean {
  return (UNSTARTED_JOB_STATUSES as readonly string[]).includes(String(status));
}

export type CancelCheckInput = { status: JobStatus | string; actorIsAdmin: boolean; reason: string | null | undefined };

/** The refusal sentence for a cancel request, or null when the rules allow it. */
export function cancelRefusal(input: CancelCheckInput): string | null {
  const status = String(input.status);
  if (status === JobStatus.CANCELLED) return "This job is already cancelled.";
  if (status === JobStatus.INVOICED) return "This job is invoiced. Remove it from the invoice or void the invoice before cancelling.";
  const reason = (input.reason ?? "").trim();
  if (reason.length < CANCEL_REASON_MIN) return "Give a reason for cancelling.";
  if (reason.length > CANCEL_REASON_MAX) return `Keep the reason under ${CANCEL_REASON_MAX} characters.`;
  if (isUnstartedStatus(status)) return null;
  if ((STARTED_CANCELLABLE_STATUSES as readonly string[]).includes(status)) {
    return input.actorIsAdmin ? null : "Only an administrator can cancel a job that has started.";
  }
  return "This job cannot be cancelled from its current status.";
}

/** The refusal sentence for a restore request, or null. */
export function restoreRefusal(input: { status: JobStatus | string; cancelledFromStatus: JobStatus | string | null }): string | null {
  if (String(input.status) !== JobStatus.CANCELLED) return "This job is not cancelled.";
  if (!input.cancelledFromStatus || !isUnstartedStatus(input.cancelledFromStatus)) {
    return "This job had started when it was cancelled, so it stays cancelled with its work record. Create a new job instead.";
  }
  return null;
}
