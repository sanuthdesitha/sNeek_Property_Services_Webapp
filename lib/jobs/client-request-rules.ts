/**
 * What a client (or their VA) may still ask for on a job, given where that job
 * has got to.
 *
 * Every one of these routes used to block only COMPLETED and INVOICED, which
 * meant a client could request a CANCELLATION on a job a cleaner was standing
 * in the middle of, or a RESCHEDULE of a clean already submitted for QA. The
 * request would be created, sit in the approvals queue, and be read by an admin
 * hours after the work had finished — a decision about something that already
 * happened.
 *
 * The rule lives here rather than in each route because it was written out
 * three times and drifted the moment one of them changed. Same reason the
 * access-info rule and the laundry skip reason each ended up with two readings.
 *
 * A refusal is not a dead end: the message tells the client to call, because
 * once a cleaner is on the way the answer genuinely is a conversation, not a
 * form.
 */

// TYPE-only: the cleaner-facing UI shares this rule, and a value import would
// drag @prisma/client into the browser bundle. String literals below are
// still checked against the enum, so a typo or a removed status fails tsc.
import type { JobStatus } from "@prisma/client";

export type ClientJobAction = "cancel" | "reschedule" | "skip";

/** Work is over. Nothing about the schedule can be requested any more. */
const FINISHED: JobStatus[] = ["COMPLETED", "INVOICED"];

/**
 * The cleaner has committed to this job today — travelling, on site, or has
 * already handed work in. Changing the schedule now is a phone call.
 */
const UNDERWAY: JobStatus[] = [
  "EN_ROUTE",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_CONTINUATION_APPROVAL",
  "SUBMITTED",
  "QA_REVIEW",
];

const ACTION_NOUN: Record<ClientJobAction, string> = {
  cancel: "cancelled",
  reschedule: "rescheduled",
  skip: "skipped",
};

export interface ClientRequestVerdict {
  allowed: boolean;
  /** Present when refused — safe to show the client verbatim. */
  reason?: string;
}

/**
 * @param job.status Where the job is now.
 * @returns allowed, or a refusal with a message written for the client.
 */
export function checkClientJobRequest(
  action: ClientJobAction,
  job: { status: JobStatus }
): ClientRequestVerdict {
  if (FINISHED.includes(job.status)) {
    return {
      allowed: false,
      reason: `This clean has already been completed, so it can no longer be ${ACTION_NOUN[action]}. Please contact us if something is wrong with it.`,
    };
  }

  if (UNDERWAY.includes(job.status)) {
    return {
      allowed: false,
      // Named deliberately: "your cleaner is already on the way" is a fact the
      // client can act on, where "this cannot be changed" only invites a retry.
      reason:
        job.status === "EN_ROUTE"
          ? `Your cleaner is already on the way, so this clean can no longer be ${ACTION_NOUN[action]} from the portal. Please call us and we will sort it out.`
          : `This clean is already under way, so it can no longer be ${ACTION_NOUN[action]} from the portal. Please call us and we will sort it out.`,
    };
  }

  return { allowed: true };
}

/** True while a client may still change the schedule themselves. */
export function isClientSchedulable(status: JobStatus): boolean {
  return !FINISHED.includes(status) && !UNDERWAY.includes(status);
}
