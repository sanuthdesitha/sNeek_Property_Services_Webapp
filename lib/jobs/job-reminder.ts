import "server-only";
import { format } from "date-fns";
import { JobStatus, NotificationChannel, NotificationStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

/**
 * Manual "Send reminder" for an unfinished job — the one service behind the
 * single-job route (`/api/admin/jobs/[id]/remind`) and the bulk route
 * (`/api/admin/jobs/bulk-remind`). Moved out of the single route unchanged:
 * only PAUSED / IN_PROGRESS / SUBMITTED jobs are remindable, every
 * non-removed active assigned cleaner is reminded by the chosen transport, and
 * every send is audited (JOB_REMINDER_SENT).
 *
 * What a "sent" name means, stated plainly for the screens:
 * - PUSH: an in-app notice was recorded for the phone app's outbox and a
 *   device push was requested. Neither confirms delivery.
 * - EMAIL: the email provider accepted the message. Acceptance is not delivery.
 */
export const REMINDABLE_STATUSES: JobStatus[] = [JobStatus.PAUSED, JobStatus.IN_PROGRESS, JobStatus.SUBMITTED];

export const reminderInputSchema = z.object({
  method: z.enum(["PUSH", "EMAIL"]),
  note: z.string().trim().max(1000).optional(),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;

export type JobReminderResult =
  | { kind: "sent"; jobId: string; label: string; sent: string[]; failed: string[] }
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
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
        await sendWebPushToUser(assignment.userId, {
          title: "Unfinished job reminder",
          body: message,
          url: "/cleaner/jobs",
          tag: `job-reminder-${job.id}`,
        });
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
              <p>Hi ${displayName},</p>
              <p>You have an unfinished job at <strong>${propertyName}</strong> scheduled <strong>${whenLabel}</strong> — please open it and submit your checklist.</p>
              ${input.note ? `<p><em>Note from admin:</em> ${input.note}</p>` : ""}
              <p><a href="${context.cleanerJobsUrl}">Open your jobs</a></p>
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
        sent,
        failed,
        note: input.note ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  return { kind: "sent", jobId, label, sent, failed };
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
