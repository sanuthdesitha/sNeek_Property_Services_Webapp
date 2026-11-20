import "server-only";
import { deviceChargeLinesForJobs } from "@/lib/property-devices/clean-notice";
import { randomUUID } from "node:crypto";
import { format } from "date-fns";
import { JobStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { outcomeTaken, sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { reminderDigestTexts } from "@/lib/notifications/wording/reminder-digest";
import { buildReminderDigestEmail, digestDayList, sortDigestJobs } from "@/lib/email-design/reminder-digest";
import { combinedReminderEntityKey, toDigestJob } from "@/lib/ops/reminder-digest-jobs";
import { getAppSettings } from "@/lib/settings";
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
 *
 * Bulk by email (2026-11-17): a cleaner on two or more of the selected jobs
 * gets ONE email listing them all (`sendBulkJobReminders`); each job still
 * gets its own row and audit with that email's outcome.
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
  | { kind: "sent"; jobId: string; label: string; sent: string[]; failed: string[]; deliveryState: ReminderDeliveryState; outcomes: RecipientOutcome[]; combinedFor?: string[] }
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
  jobType: true,
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

type ReminderJob = Prisma.JobGetPayload<{ select: typeof jobSelect }>;

/** Loads a job and checks it can be reminded; the job when it can. */
async function loadRemindableJob(jobId: string): Promise<{ job: ReminderJob; label: string } | { refused: JobReminderResult }> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: jobSelect });
  if (!job) return { refused: { kind: "not_found", jobId } };
  const label = jobLabel(job);
  if (!REMINDABLE_STATUSES.includes(job.status)) {
    return {
      refused: {
        kind: "not_remindable",
        jobId,
        label,
        status: job.status,
        error: `Job is ${job.status.replace(/_/g, " ").toLowerCase()} — not in a remindable state.`,
      },
    };
  }
  if (job.assignments.length === 0) {
    return { refused: { kind: "no_cleaners", jobId, label, error: "No assigned cleaners to remind." } };
  }
  return { job, label };
}

export async function sendJobReminder(jobId: string, input: ReminderInput, context: ReminderContext): Promise<JobReminderResult> {
  const loaded = await loadRemindableJob(jobId);
  if ("refused" in loaded) return loaded.refused;
  return remindLoadedJob(loaded.job, loaded.label, input, context);
}

/**
 * Cleaners of this job whose email went out in one combined email with their
 * other selected jobs (bulk email reminder): they are not emailed again here,
 * and that email's outcome counts for this job.
 */
type CombinedForJob = { userIds: ReadonlySet<string>; outcomes: RecipientOutcome[]; names: string[]; emailJobIds: Record<string, string[]> };

async function remindLoadedJob(job: ReminderJob, label: string, input: ReminderInput, context: ReminderContext, combined?: CombinedForJob): Promise<JobReminderResult> {
  const jobId = job.id;
  const propertyName = job.property?.name ?? "the property";
  const whenLabel = `${format(new Date(job.scheduledDate), "EEE d MMM yyyy")}${job.startTime ? ` ${job.startTime}` : ""}`;
  const wording = await loadNotificationWording(JOB_REMINDER_TYPE_KEY);
  const inbox = wording.render("cleaner", "INBOX", {
    propertyName,
    when: whenLabel,
    noteSentence: wording.line("note-line", "INBOX", { note: input.note }, Boolean(input.note)),
  });
  const noteParagraph = wording.line("note-paragraph", "EMAIL", { note: input.note }, Boolean(input.note));
  const controls = await getNotificationTypeControls();
  const ownRecipients = job.assignments.filter((assignment) => !combined?.userIds.has(assignment.userId));

  // The pipeline enqueue is one transaction: if it fails, nothing was queued
  // or sent for anyone, so every cleaner is reported as not reminded (and the
  // audit says why) instead of failing the whole request.
  let pipelineError: string | null = null;
  const ownOutcomes = ownRecipients.length === 0 ? [] : await sendOfficeNotification({
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
    subject: inbox.title,
    body: inbox.body,
    url: "/cleaner/jobs",
    emailKind: "job_reminder",
    email: (recipient) => {
      const email = wording.render("cleaner", "EMAIL", {
        recipientName: recipient.name ?? recipient.email ?? "Cleaner",
        propertyName,
        when: whenLabel,
        jobNumber: job.jobNumber || job.id,
        noteParagraph,
        jobsUrl: context.cleanerJobsUrl,
      });
      return { subject: email.subject, html: email.html };
    },
    transports: [input.method],
    recipients: ownRecipients.map((assignment) => ({
      id: assignment.user.id,
      role: assignment.user.role,
      name: assignment.user.name,
      email: assignment.user.email,
    })),
    respectsPreferences: typeRespectsPreferences(controls, JOB_REMINDER_TYPE_KEY),
    disabledTransports: controls.disabledTransports[JOB_REMINDER_TYPE_KEY] ?? [],
  }).catch((): RecipientOutcome[] => {
    pipelineError = "pipeline_unavailable";
    return [];
  });
  const outcomes = [...ownOutcomes, ...(combined?.outcomes ?? [])];

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
        // Cleaners emailed once for several selected jobs: the jobs that one email covered.
        ...(combined && combined.userIds.size > 0 ? { combinedEmails: combined.emailJobIds } : {}),
        note: input.note ?? null,
        error: pipelineError,
      } as Prisma.InputJsonValue,
    },
  });

  return { kind: "sent", jobId, label, sent, failed, deliveryState, outcomes, ...(combined?.names.length ? { combinedFor: combined.names } : {}) };
}

type CombinedCleaner = { recipient: OfficeRecipient; jobs: ReminderJob[] };

/** Cleaners on two or more of the selected jobs, each with their jobs in selection order. */
function cleanersOnSeveralJobs(jobs: readonly ReminderJob[]): CombinedCleaner[] {
  const byCleaner = new Map<string, CombinedCleaner>();
  for (const job of jobs) {
    for (const assignment of job.assignments) {
      const entry = byCleaner.get(assignment.userId) ?? {
        recipient: { id: assignment.user.id, role: assignment.user.role, name: assignment.user.name, email: assignment.user.email },
        jobs: [],
      };
      if (!entry.jobs.some((existing) => existing.id === job.id)) entry.jobs.push(job);
      byCleaner.set(assignment.userId, entry);
    }
  }
  return Array.from(byCleaner.values()).filter((entry) => entry.jobs.length > 1);
}

/** ONE email to a cleaner listing every selected job of theirs (bulk email reminder). */
async function sendCombinedManualReminder(cleaner: CombinedCleaner, input: ReminderInput, context: ReminderContext): Promise<RecipientOutcome[]> {
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const chargeLines = await deviceChargeLinesForJobs(cleaner.jobs.map((job) => job.id));
  const jobs = sortDigestJobs(cleaner.jobs.map((job) => toDigestJob(job, { timezone, defaultTime: "09:00", priorityLines: chargeLines.get(job.id) })));
  const jobIds = jobs.map((job) => job.jobId);
  const wording = await loadNotificationWording(JOB_REMINDER_TYPE_KEY);
  const userName = cleaner.recipient.name ?? cleaner.recipient.email ?? "Cleaner";
  const texts = reminderDigestTexts(wording, { userName, jobCount: jobs.length, dayList: digestDayList(jobs), note: input.note });
  const email = buildReminderDigestEmail(settings, { kind: "manual", jobs, texts, actionUrl: context.cleanerJobsUrl });
  const controls = await getNotificationTypeControls();
  const batchKey = combinedReminderEntityKey(cleaner.recipient.id, jobIds);
  return sendOfficeNotification({
    typeKey: JOB_REMINDER_TYPE_KEY,
    eventKey: JOB_REMINDER_TYPE_KEY,
    eventId: `job-reminder-digest:${cleaner.recipient.id}:${input.method}:${input.idempotencyKey ?? randomUUID()}`,
    entity: { type: "JobReminderBatch", id: batchKey.slice(batchKey.indexOf(":") + 1) },
    actorId: context.actorId,
    // The scope is re-checked on the first job; every job was loaded with its live assignments just now.
    scopeType: "JOB_ASSIGNED_CLEANER",
    scopeId: () => jobIds[0],
    category: "jobs",
    severity: "ACTION",
    jobId: null,
    subject: email.subject,
    body: `${email.subject}: ${jobs.map((job) => `${job.jobReference} ${job.propertyName}`).join("; ")}`,
    url: "/cleaner/jobs",
    emailKind: "job_reminder",
    email: () => ({ subject: email.subject, html: email.html }),
    transports: ["EMAIL"],
    recipients: [cleaner.recipient],
    respectsPreferences: typeRespectsPreferences(controls, JOB_REMINDER_TYPE_KEY),
    disabledTransports: controls.disabledTransports[JOB_REMINDER_TYPE_KEY] ?? [],
    relatedEntityKeys: jobIds.map((jobId) => `Job:${jobId}`),
  });
}

/**
 * The bulk reminder. Push: one reminder per job, as before. Email: a cleaner
 * on two or more of the selected jobs gets ONE email listing them all (owner,
 * 2026-11-17); a cleaner on one selected job gets that job's usual email.
 * Every job keeps its own row and audit, with the outcome of the email that
 * covered it.
 */
export async function sendBulkJobReminders(jobIds: readonly string[], input: ReminderInput, context: ReminderContext): Promise<BulkReminderRow[]> {
  const uniqueIds = Array.from(new Set(jobIds));
  // A retried request with the same key queues nothing twice (per job, and per cleaner for a combined email).
  const keyFor = (suffix: string) => (input.idempotencyKey ? `${input.idempotencyKey}:${suffix}`.slice(0, 100) : undefined);
  const failedRow = (jobId: string): BulkReminderRow => ({ jobId, label: jobId, outcome: "failed", requested: [], failed: [], message: "The reminder could not be sent. Try this job again." });

  if (input.method !== "EMAIL") {
    const rows: BulkReminderRow[] = [];
    // Sequential: each job already fans out to its cleaners.
    for (const jobId of uniqueIds) {
      try {
        rows.push(bulkReminderRow(await sendJobReminder(jobId, { ...input, idempotencyKey: keyFor(jobId) }, context), input.method));
      } catch {
        rows.push(failedRow(jobId));
      }
    }
    return rows;
  }

  const loaded = new Map<string, Awaited<ReturnType<typeof loadRemindableJob>> | null>();
  for (const jobId of uniqueIds) {
    loaded.set(jobId, await loadRemindableJob(jobId).catch(() => null));
  }
  const remindable = uniqueIds.flatMap((jobId) => {
    const entry = loaded.get(jobId);
    return entry && "job" in entry ? [entry.job] : [];
  });

  const combinedByJob = new Map<string, CombinedForJob>();
  for (const cleaner of cleanersOnSeveralJobs(remindable)) {
    const outcomes = await sendCombinedManualReminder(cleaner, { ...input, idempotencyKey: keyFor(`digest:${cleaner.recipient.id}`) }, context)
      .catch((): RecipientOutcome[] => [{ userId: cleaner.recipient.id, name: cleaner.recipient.name ?? cleaner.recipient.email ?? "Cleaner", transport: "EMAIL", path: "pipeline", state: "failed", errorCode: "pipeline_unavailable" }]);
    const coveredIds = cleaner.jobs.map((job) => job.id);
    for (const job of cleaner.jobs) {
      const entry = combinedByJob.get(job.id) ?? { userIds: new Set<string>(), outcomes: [], names: [], emailJobIds: {} };
      (entry.userIds as Set<string>).add(cleaner.recipient.id);
      entry.outcomes.push(...outcomes);
      entry.names.push(cleaner.recipient.name ?? cleaner.recipient.email ?? "Cleaner");
      entry.emailJobIds[cleaner.recipient.id] = coveredIds;
      combinedByJob.set(job.id, entry);
    }
  }

  const rows: BulkReminderRow[] = [];
  for (const jobId of uniqueIds) {
    const entry = loaded.get(jobId);
    try {
      if (!entry) throw new Error("load_failed");
      if ("refused" in entry) {
        rows.push(bulkReminderRow(entry.refused, input.method));
        continue;
      }
      const result = await remindLoadedJob(entry.job, entry.label, { ...input, idempotencyKey: keyFor(jobId) }, context, combinedByJob.get(jobId));
      rows.push(bulkReminderRow(result, input.method));
    } catch {
      rows.push(failedRow(jobId));
    }
  }
  return rows;
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
  const combined = result.combinedFor?.length ? ` One email listed all selected jobs for ${result.combinedFor.join(", ")}.` : "";
  return { jobId: result.jobId, label: result.label, outcome, requested: result.sent, failed: result.failed, message: `${message}${combined}` };
}

export type BulkRemindResponse = {
  method: ReminderInput["method"];
  rows: BulkReminderRow[];
  summary: { requested: number; partial: number; failed: number; skipped: number; notFound: number };
};
