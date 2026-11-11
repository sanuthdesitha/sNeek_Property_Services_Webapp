import "server-only";
import { randomUUID } from "node:crypto";
import { format } from "date-fns";
import { JobStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { outcomeTaken, sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";

/**
 * Manual "Send reminder" for an unfinished job — the one service behind the
 * single-job route (`/api/admin/jobs/[id]/remind`) and the bulk route
 * (`/api/admin/jobs/bulk-remind`). Only PAUSED / IN_PROGRESS / SUBMITTED jobs
 * are remindable, every non-removed active assigned cleaner is reminded by the
 * chosen transport, and every send is audited (JOB_REMINDER_SENT).
 *
 * On the durable notification pipeline (catalog type `job.reminder.manual`)
 * since 2026-11-11, with the JOB_ASSIGNED_CLEANER recipient scope (re-checked
 * when queued and when dispatched):
 * - PUSH: the inbox row is a pipeline INBOX intent, delivered at once, that
 *   explicitly carries the phone-app push marker the legacy row had. The
 *   browser push goes through the pipeline when the outbox WEB_PUSH transport
 *   is on, otherwise directly as before.
 * - EMAIL: through the pipeline when the outbox EMAIL transport is on,
 *   otherwise directly as before (now also recorded in the delivery log).
 * Personal preferences are ignored unless an administrator switches them on
 * for this type in the notifications area (the previous behaviour is the
 * default). `sent` keeps its name for compatibility; `deliveryState` and the
 * per-recipient `outcomes` say what really happened.
 */
export const REMINDABLE_STATUSES: JobStatus[] = [JobStatus.PAUSED, JobStatus.IN_PROGRESS, JobStatus.SUBMITTED];
export const JOB_REMINDER_TYPE_KEY = "job.reminder.manual";

export const reminderInputSchema = z.object({
  method: z.enum(["PUSH", "EMAIL"]),
  note: z.string().trim().max(1000).optional(),
  /** Optional client key: a retried request queues nothing twice. */
  idempotencyKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/).optional(),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

/** What the reminder actually achieved. Never "delivered": nothing here confirms delivery. */
export type ReminderDeliveryState = "QUEUED" | "PROVIDER_ACCEPTED";

export type JobReminderResult =
  | { kind: "sent"; jobId: string; label: string; sent: string[]; failed: string[]; deliveryState: ReminderDeliveryState; outcomes: RecipientOutcome[] }
  | { kind: "not_found"; jobId: string }
  | { kind: "not_remindable"; jobId: string; label: string; status: JobStatus; error: string }
  | { kind: "no_cleaners"; jobId: string; label: string; error: string };

type ReminderContext = {
  actorId: string;
  /** Absolute link to the cleaner's jobs, resolved by the route. */
  cleanerJobsUrl: string;
};

const jobSelect = {
  id: true,
  jobNumber: true,
  status: true,
  scheduledDate: true,
  startTime: true,
  property: { select: { name: true, address: true } },
  assignments: {
    where: { removedAt: null, user: { isActive: true } },
    select: { userId: true, user: { select: { id: true, name: true, email: true, role: true } } },
  },
} satisfies Prisma.JobSelect;

function jobLabel(job: { jobNumber: string | null; id: string; property: { name: string } | null }) {
  return `${job.jobNumber || job.id} · ${job.property?.name ?? "Unknown property"}`;
}

/** Overall wording for the screens: email accepted by the provider only on the direct path. */
export function reminderDeliveryState(method: ReminderInput["method"], outcomes: RecipientOutcome[]): ReminderDeliveryState {
  if (method === "PUSH") return "QUEUED";
  return outcomes.some((outcome) => outcome.transport === "EMAIL" && outcome.state === "provider_accepted") ? "PROVIDER_ACCEPTED" : "QUEUED";
}

/** A cleaner counts as reminded when the transport they were asked for took the message. */
function remindedBy(method: ReminderInput["method"], outcomes: RecipientOutcome[], userId: string): boolean {
  const primary = method === "PUSH" ? "INBOX" : "EMAIL";
  return outcomes.some((outcome) => outcome.userId === userId && outcome.transport === primary && outcomeTaken(outcome));
}

export async function sendJobReminder(jobId: string, input: ReminderInput, context: ReminderContext): Promise<JobReminderResult> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: jobSelect });
  if (!job) return { kind: "not_found", jobId };
  const label = jobLabel(job);
  if (!REMINDABLE_STATUSES.includes(job.status)) {
    return {
      kind: "not_remindable",
      jobId,
      label,
      status: job.status,
      error: `Job is ${job.status.replace(/_/g, " ").toLowerCase()} — not in a remindable state.`,
    };
  }
  if (job.assignments.length === 0) {
    return { kind: "no_cleaners", jobId, label, error: "No assigned cleaners to remind." };
  }

  const propertyName = job.property?.name ?? "the property";
  const whenLabel = `${format(new Date(job.scheduledDate), "EEE d MMM yyyy")}${job.startTime ? ` ${job.startTime}` : ""}`;
  const message = `You have an unfinished job at ${propertyName} scheduled ${whenLabel} — please open it and submit your checklist.${
    input.note ? ` Note from admin: ${input.note}` : ""
  }`;
  const safeProperty = escapeHtml(propertyName);
  const safeWhen = escapeHtml(whenLabel);
  const safeNote = input.note ? escapeHtml(input.note) : null;
  const controls = await getNotificationTypeControls();

  const outcomes = await sendOfficeNotification({
    typeKey: JOB_REMINDER_TYPE_KEY,
    eventKey: JOB_REMINDER_TYPE_KEY,
    eventId: `job-reminder:${job.id}:${input.method}:${input.idempotencyKey ?? randomUUID()}`,
    entity: { type: "Job", id: job.id },
    actorId: context.actorId,
    scopeType: "JOB_ASSIGNED_CLEANER",
    scopeId: () => job.id,
    category: "jobs",
    severity: "ACTION",
    jobId: job.id,
    subject: "Unfinished job reminder",
    body: message,
    url: "/cleaner/jobs",
    emailKind: "job_reminder",
    email: (recipient) => ({
      subject: `Reminder: unfinished job at ${propertyName} (${job.jobNumber || job.id})`,
      html: `
              <p>Hi ${escapeHtml(recipient.name ?? recipient.email ?? "Cleaner")},</p>
              <p>You have an unfinished job at <strong>${safeProperty}</strong> scheduled <strong>${safeWhen}</strong> — please open it and submit your checklist.</p>
              ${safeNote ? `<p><em>Note from admin:</em> ${safeNote}</p>` : ""}
              <p><a href="${escapeHtml(context.cleanerJobsUrl)}">Open your jobs</a></p>
              <p>— sNeek Ops</p>
            `,
    }),
    transports: [input.method],
    recipients: job.assignments.map((assignment) => ({
      id: assignment.user.id,
      role: assignment.user.role,
      name: assignment.user.name,
      email: assignment.user.email,
    })),
    respectsPreferences: typeRespectsPreferences(controls, JOB_REMINDER_TYPE_KEY),
    disabledTransports: controls.disabledTransports[JOB_REMINDER_TYPE_KEY] ?? [],
  });

  const sent: string[] = [];
  const failed: string[] = [];
  for (const assignment of job.assignments) {
    const name = assignment.user.name ?? assignment.user.email ?? "Cleaner";
    (remindedBy(input.method, outcomes, assignment.userId) ? sent : failed).push(name);
  }

  const deliveryState = reminderDeliveryState(input.method, outcomes);
  await db.auditLog.create({
    data: {
      userId: context.actorId,
      jobId: job.id,
      action: "JOB_REMINDER_SENT",
      entity: "Job",
      entityId: job.id,
      after: {
        method: input.method,
        cleanerIds: job.assignments.map((a) => a.userId),
        // Names the transport took (queued / inbox available / accepted), not deliveries.
        requested: sent,
        failed,
        deliveryState,
        deliveryConfirmed: false,
        // Which path each transport used (pipeline or direct) and its state.
        outcomes: outcomes.map((outcome) => ({ userId: outcome.userId, transport: outcome.transport, path: outcome.path, state: outcome.state, errorCode: outcome.errorCode ?? null })),
        note: input.note ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return { kind: "sent", jobId, label, sent, failed, deliveryState, outcomes };
}

/** Per-row outcome of the bulk reminder, worded so queued is never read as delivered. */
export type BulkReminderOutcome = "requested" | "partial" | "failed" | "skipped" | "not_found";

export type BulkReminderRow = {
  jobId: string;
  label: string;
  outcome: BulkReminderOutcome;
  /** Cleaners the transport took the message for (queued, or accepted by the provider). */
  requested: string[];
  failed: string[];
  message: string;
};

export function bulkReminderRow(result: JobReminderResult, method: ReminderInput["method"]): BulkReminderRow {
  if (result.kind === "not_found") {
    return { jobId: result.jobId, label: result.jobId, outcome: "not_found", requested: [], failed: [], message: "Job not found. Refresh the list." };
  }
  if (result.kind === "not_remindable" || result.kind === "no_cleaners") {
    return { jobId: result.jobId, label: result.label, outcome: "skipped", requested: [], failed: [], message: result.error };
  }
  const transport = method === "PUSH" ? "Push requested" : result.deliveryState === "PROVIDER_ACCEPTED" ? "Email accepted by the provider" : "Email queued";
  const caveat = "delivery is not confirmed";
  const outcome: BulkReminderOutcome = result.sent.length === 0 ? "failed" : result.failed.length > 0 ? "partial" : "requested";
  const message = outcome === "failed"
    ? `Not sent to ${result.failed.join(", ")}.`
    : `${transport} for ${result.sent.join(", ")}; ${caveat}.${result.failed.length > 0 ? ` Not sent to ${result.failed.join(", ")}.` : ""}`;
  return { jobId: result.jobId, label: result.label, outcome, requested: result.sent, failed: result.failed, message };
}

export type BulkRemindResponse = {
  method: ReminderInput["method"];
  rows: BulkReminderRow[];
  summary: { requested: number; partial: number; failed: number; skipped: number; notFound: number };
};
