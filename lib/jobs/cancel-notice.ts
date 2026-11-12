import "server-only";
/**
 * Cleaner notices for "Cancel job" and "Restore" (catalog types `job.cancelled`
 * and `job.cancel_restored`), on the notification intent pipeline. INBOX ONLY,
 * chosen explicitly: the office-send helper's "PUSH" option is used for its
 * inbox row, and the phone and browser pushes are switched off for these
 * types, so an inbox notice never silently becomes a device push, email or
 * SMS. Outcomes are reported as queued / inbox available — never "delivered".
 */
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";

export const JOB_CANCELLED_TYPE_KEY = "job.cancelled";
export const JOB_CANCEL_RESTORED_TYPE_KEY = "job.cancel_restored";

type NoticeJob = { id: string; jobNumber: string; propertyName: string; dayLabel: string };

export type CancelNoticeOutcome = { userId: string; name: string; state: RecipientOutcome["state"] };

function inboxOnly(outcomes: RecipientOutcome[]): CancelNoticeOutcome[] {
  return outcomes.filter((outcome) => outcome.transport === "INBOX").map((outcome) => ({ userId: outcome.userId, name: outcome.name, state: outcome.state }));
}

async function send(input: {
  typeKey: string;
  eventId: string;
  job: NoticeJob;
  actorId: string;
  recipients: OfficeRecipient[];
  scope: "STAFF_MEMBER" | "JOB_ASSIGNED_CLEANER";
  subject: string;
  body: string;
}): Promise<CancelNoticeOutcome[]> {
  if (input.recipients.length === 0) return [];
  const controls = await getNotificationTypeControls();
  const outcomes = await sendOfficeNotification({
    typeKey: input.typeKey,
    eventKey: input.typeKey,
    eventId: input.eventId,
    entity: { type: "Job", id: input.job.id },
    actorId: input.actorId,
    scopeType: input.scope,
    scopeId: (recipient) => (input.scope === "STAFF_MEMBER" ? recipient.id : input.job.id),
    category: "jobs",
    severity: "ACTION",
    jobId: input.job.id,
    subject: input.subject,
    body: input.body,
    url: "/cleaner/jobs",
    transports: ["PUSH"],
    recipients: input.recipients,
    respectsPreferences: typeRespectsPreferences(controls, input.typeKey),
    // Inbox only: the phone and browser pushes of "PUSH" are switched off here.
    disabledTransports: Array.from(new Set([...(controls.disabledTransports[input.typeKey] ?? []), "MOBILE_PUSH", "WEB_PUSH"] as const)),
  });
  return inboxOnly(outcomes);
}

export async function sendJobCancelledNotice(input: { job: NoticeJob; reason: string; actorId: string; recipients: OfficeRecipient[]; cancelledAtIso: string }): Promise<CancelNoticeOutcome[]> {
  return send({
    typeKey: JOB_CANCELLED_TYPE_KEY,
    eventId: `job-cancelled:${input.job.id}:${input.cancelledAtIso}`,
    job: input.job,
    actorId: input.actorId,
    recipients: input.recipients,
    scope: "STAFF_MEMBER",
    subject: "Job cancelled",
    body: `The job at ${input.job.propertyName} on ${input.job.dayLabel} (${input.job.jobNumber}) has been cancelled. You no longer need to attend. Reason: ${input.reason}`,
  });
}

export async function sendJobRestoredNotice(input: { job: NoticeJob; actorId: string; recipients: OfficeRecipient[]; restoredAtIso: string }): Promise<CancelNoticeOutcome[]> {
  return send({
    typeKey: JOB_CANCEL_RESTORED_TYPE_KEY,
    eventId: `job-cancel-restored:${input.job.id}:${input.restoredAtIso}`,
    job: input.job,
    actorId: input.actorId,
    recipients: input.recipients,
    scope: "JOB_ASSIGNED_CLEANER",
    subject: "Cancelled job is back on",
    body: `The job at ${input.job.propertyName} on ${input.job.dayLabel} (${input.job.jobNumber}) was cancelled and is now back on your list. Open it to confirm.`,
  });
}
