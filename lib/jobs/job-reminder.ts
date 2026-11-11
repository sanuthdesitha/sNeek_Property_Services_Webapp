import "server-only";
import { format } from "date-fns";
import { JobStatus, NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendWebPushToUser } from "@/lib/notifications/web-push";
import { logger } from "@/lib/logger";
import { escapeHtml } from "@/lib/utils/escape-html";

/**
 * Manual "Send reminder" for an unfinished job — the one service behind the
 * single-job route (`/api/admin/jobs/[id]/remind`) and the bulk route
 * (`/api/admin/jobs/bulk-remind`). Moved out of the single route unchanged:
 * only PAUSED / IN_PROGRESS / SUBMITTED jobs are remindable, every
 * non-removed active assigned cleaner is reminded by the chosen transport, and
 * every send is audited (JOB_REMINDER_SENT).
 *
 * What a "sent" name means, stated plainly for the screens (the response keeps
 * the `sent` key for compatibility; `deliveryState` says what it really is):
 * - PUSH: an in-app notice was recorded and its phone push is QUEUED in the
 *   mobile outbox (dispatched later by the worker); a browser push is
 *   requested best-effort. Neither confirms delivery.
 * - EMAIL: the email provider accepted the message. Acceptance is not delivery.
 *
 * Not yet on the durable notification-intent pipeline (`lib/notifications/
 * intent-store.ts`): that pipeline only authorizes ADMIN_OPERATIONS recipients,
 * has no phone-app transport, and sends external transports only when
 * SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS opts in. See docs/SYSTEM.md,
 * "Existing problems fixed (2026-11-11)".
 */
export const REMINDABLE_STATUSES: JobStatus[] = [JobStatus.PAUSED, JobStatus.IN_PROGRESS, JobStatus.SUBMITTED];

export const reminderInputSchema = z.object({
  method: z.enum(["PUSH", "EMAIL"]),
  note: z.string().trim().max(1000).optional(),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

/** What the reminder actually achieved. Never "delivered": nothing here confirms delivery. */
export type ReminderDeliveryState = "QUEUED" | "PROVIDER_ACCEPTED";

export function reminderDeliveryState(method: ReminderInput["method"]): ReminderDeliveryState {
  return method === "PUSH" ? "QUEUED" : "PROVIDER_ACCEPTED";
}

export type JobReminderResult =
  | { kind: "sent"; jobId: string; label: string; sent: string[]; failed: string[]; deliveryState: ReminderDeliveryState }
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
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.JobSelect;

function jobLabel(job: { jobNumber: string | null; id: string; property: { name: string } | null }) {
  return `${job.jobNumber || job.id} · ${job.property?.name ?? "Unknown property"}`;
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

  const sent: string[] = [];
  const failed: string[] = [];
  const safeProperty = escapeHtml(propertyName);
  const safeWhen = escapeHtml(whenLabel);
  const safeNote = input.note ? escapeHtml(input.note) : null;

  for (const assignment of job.assignments) {
    const displayName = assignment.user.name ?? assignment.user.email ?? "Cleaner";
    try {
      if (input.method === "PUSH") {
        await db.notification.create({
          data: {
            userId: assignment.userId,
            jobId: job.id,
            externalId: mobilePendingMarker("jobs"),
            channel: NotificationChannel.PUSH,
            subject: "Unfinished job reminder",
            body: message,
            // PUSH + SENT is the inbox convention ("available in the inbox");
            // the phone push stays pending in the mobile-outbox marker above.
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
        // The inbox notice is recorded; a failed browser push must not report
        // the cleaner as "not reminded" (a retry would duplicate the notice).
        try {
          await sendWebPushToUser(assignment.userId, {
            title: "Unfinished job reminder",
            body: message,
            url: "/cleaner/jobs",
            tag: `job-reminder-${job.id}`,
          });
        } catch (err) {
          logger.warn({ err, jobId: job.id, userId: assignment.userId }, "Job reminder browser push failed (inbox notice recorded)");
        }
        sent.push(displayName);
      } else {
        if (!assignment.user.email) {
          failed.push(displayName);
          continue;
        }
        const res = await sendEmailDetailed({
          kind: "job_reminder",
          to: assignment.user.email,
          subject: `Reminder: unfinished job at ${propertyName} (${job.jobNumber || job.id})`,
          html: `
              <p>Hi ${escapeHtml(displayName)},</p>
              <p>You have an unfinished job at <strong>${safeProperty}</strong> scheduled <strong>${safeWhen}</strong> — please open it and submit your checklist.</p>
              ${safeNote ? `<p><em>Note from admin:</em> ${safeNote}</p>` : ""}
              <p><a href="${escapeHtml(context.cleanerJobsUrl)}">Open your jobs</a></p>
              <p>— sNeek Ops</p>
            `,
        });
        if (res.ok) sent.push(displayName);
        else failed.push(displayName);
      }
    } catch {
      failed.push(displayName);
    }
  }

  const deliveryState = reminderDeliveryState(input.method);
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
        // Names the transport took (push queued / email accepted), not deliveries.
        requested: sent,
        failed,
        deliveryState,
        deliveryConfirmed: false,
        note: input.note ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return { kind: "sent", jobId, label, sent, failed, deliveryState };
}

/** Per-row outcome of the bulk reminder, worded so queued is never read as delivered. */
export type BulkReminderOutcome = "requested" | "partial" | "failed" | "skipped" | "not_found";

export type BulkReminderRow = {
  jobId: string;
  label: string;
  outcome: BulkReminderOutcome;
  /** Cleaners the transport accepted (email) or a push was requested for. */
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
  const transport = method === "PUSH" ? "Push requested" : "Email accepted by the provider";
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
