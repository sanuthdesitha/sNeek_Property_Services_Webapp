import { createHash } from "node:crypto";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { renderEmailTemplate } from "@/lib/email-templates";
import { getJobReference } from "@/lib/jobs/job-number";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { logger } from "@/lib/logger";
import { sendEmailDetailed, type EmailSendResult } from "@/lib/notifications/email";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";
import { reminderDigestTexts } from "@/lib/notifications/wording/reminder-digest";
import { buildReminderDigestEmail, digestDayList, sortDigestJobs } from "@/lib/email-design/reminder-digest";
import { resolveAppUrl } from "@/lib/app-url";
import { toDigestJob } from "@/lib/ops/reminder-digest-jobs";

export const SCHEDULED_REMINDER_TYPE_KEY = "job.reminder.scheduled";

/** The 2-hour reminder SMS (catalog type job.reminder.scheduled, part "cleaner"). */
export function scheduledReminderSms(
  wording: WordingRenderer,
  job: { startTime?: string | null; property: { name: string; address: string } },
  timingText: string
): string {
  return wording.render("cleaner", "SMS", {
    propertyName: job.property.name,
    when: job.startTime ?? "today",
    propertyAddress: job.property.address,
    timingSuffix: wording.line("timing-line", "SMS", { timingFlags: timingText }, Boolean(timingText)),
  }).body;
}

export interface DispatchJobRemindersOptions {
  now?: Date;
  reminderType?: "LONG" | "SHORT" | "ALL";
  force?: boolean;
  ignoreEnabled?: boolean;
  useNextAvailableDate?: boolean;
}

/** Per-recipient outcome so admins can retry a single failed send (not the whole batch). */
export interface ReminderRecipientResult {
  jobId: string;
  jobNumber: string;
  propertyName: string;
  recipient: string;
  contact: string;
  channel: "email" | "sms";
  status: "sent" | "failed" | "skipped";
  error?: string;
  /**
   * Set when this job went out inside one combined email with the cleaner's
   * other jobs of the same run: the same `id` on every job that email
   * covered, and their job numbers in list order. A retry ("Resend") still
   * resends one job.
   */
  combinedEmail?: { id: string; jobCount: number; jobNumbers: string[] };
}

function toUtcDayRange(date: Date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function resolveScheduledAt(
  job: {
    scheduledDate: Date;
    startTime?: string | null;
    dueTime?: string | null;
    endTime?: string | null;
  },
  timezone: string
) {
  const localDate = toZonedTime(job.scheduledDate, timezone);
  const datePart = format(localDate, "yyyy-MM-dd");
  const timeValue = job.startTime || job.dueTime || job.endTime || "09:00";
  const safeTime = /^\d{2}:\d{2}$/.test(timeValue) ? timeValue : "09:00";
  return fromZonedTime(`${datePart}T${safeTime}:00`, timezone);
}

function isInsideReminderWindow(scheduledAt: Date, now: Date, hoursBefore: number) {
  const deltaHours = (scheduledAt.getTime() - now.getTime()) / 3600_000;
  return deltaHours <= hoursBefore && deltaHours > 0;
}

async function findNextScheduledDate(now: Date) {
  const nextJob = await db.job.findFirst({
    where: {
      scheduledDate: { gte: now },
      status: { in: ["ASSIGNED"] },
    },
    select: { scheduledDate: true },
    orderBy: { scheduledDate: "asc" },
  });
  return nextJob?.scheduledDate ?? null;
}

type ReminderFlag = "reminder24hSent" | "reminder2hSent";

/** Atomically claim a job's reminder (false -> true). Only the claimer sends. */
async function claimReminder(jobId: string, flag: ReminderFlag): Promise<boolean> {
  const claimed = await db.job.updateMany({ where: { id: jobId, [flag]: false }, data: { [flag]: true } });
  return claimed.count === 1;
}

async function releaseReminder(jobId: string, flag: ReminderFlag) {
  await db.job.updateMany({ where: { id: jobId, [flag]: true }, data: { [flag]: false } });
}

/**
 * Did this email reach the provider (or the safeguards decided it)? A send
 * the provider may have taken, or one the safeguards held or dropped, must
 * not be tried again on the next tick.
 */
function emailReachedProvider(result: { ok: boolean; acceptance?: string; suppressed?: unknown }): boolean {
  return result.ok || result.acceptance === "UNKNOWN" || Boolean(result.suppressed);
}


/** A job the 24-hour reminder run selected (both queries select these fields). */
type LongReminderJob = {
  id: string;
  jobNumber?: string | null;
  jobType: string;
  scheduledDate: Date;
  startTime: string | null;
  dueTime: string | null;
  endTime: string | null;
  internalNotes: string | null;
  property: { name: string; address: string };
  assignments: Array<{ user: { name: string | null; email: string | null } }>;
};

/** One cleaner's email in a 24-hour reminder run: every job of theirs that was claimed. */
type CleanerEmailBatch = { email: string; displayName: string; jobs: LongReminderJob[] };

type JobEmailOutcome = { delivered: boolean; reachedProvider: boolean };

type SendLongContext = {
  settings: AppSettings;
  timezone: string;
  recipients: ReminderRecipientResult[];
};

/** The safeguard subject of a combined email: one key for the set of jobs (stable for the same set). */
export function combinedReminderEntityKey(cleanerEmail: string, jobIds: readonly string[]): string {
  const digest = createHash("sha256").update(JSON.stringify([cleanerEmail.trim().toLowerCase(), [...jobIds].sort()])).digest("hex").slice(0, 24);
  return `JobReminderBatch:${digest}`;
}

/** Group claimed jobs by cleaner email (one email per cleaner); a cleaner without email is reported per job. */
function groupJobsByCleaner(jobs: readonly LongReminderJob[], recipients: ReminderRecipientResult[]): CleanerEmailBatch[] {
  const batches = new Map<string, CleanerEmailBatch>();
  for (const job of jobs) {
    for (const assignment of job.assignments) {
      const displayName = assignment.user.name ?? assignment.user.email ?? "Team member";
      const email = assignment.user.email?.trim();
      if (!email) {
        recipients.push({
          jobId: job.id,
          jobNumber: getJobReference(job),
          propertyName: job.property.name,
          recipient: displayName,
          contact: "",
          channel: "email",
          status: "skipped",
          error: "No email on file",
        });
        continue;
      }
      const key = email.toLowerCase();
      const batch = batches.get(key) ?? { email, displayName, jobs: [] };
      if (!batch.jobs.some((existing) => existing.id === job.id)) batch.jobs.push(job);
      batches.set(key, batch);
    }
  }
  return Array.from(batches.values());
}

/** The per-job 24-hour reminder (unchanged): one job, its own email and safeguard subject. */
async function sendSingleJobReminderEmail(batch: CleanerEmailBatch, job: LongReminderJob, settings: AppSettings) {
  const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ") || "No special timing notes";
  const emailTemplate = renderEmailTemplate(settings, "jobReminder24h", {
    userName: batch.displayName,
    jobType: job.jobType.replace(/_/g, " "),
    propertyName: job.property.name,
    propertyAddress: job.property.address,
    when: job.startTime ?? "Time TBD",
    timingFlags: timingText,
    jobNumber: getJobReference(job),
    jobUrl: "/cleaner/jobs",
    actionUrl: "/cleaner/jobs",
    actionLabel: "Open jobs",
  });
  return sendEmailDetailed({ kind: "job_reminder",
    to: batch.email,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    safeguard: { typeKey: SCHEDULED_REMINDER_TYPE_KEY, entityKey: `Job:${job.id}` },
  });
}

/** One email listing every job of this cleaner's batch, in date and start-time order. */
async function sendCombinedReminderEmail(batch: CleanerEmailBatch, context: SendLongContext, wording: WordingRenderer) {
  const jobs = sortDigestJobs(batch.jobs.map((job) => toDigestJob(job, { timezone: context.timezone, defaultTime: "09:00" })));
  const texts = reminderDigestTexts(wording, { userName: batch.displayName, jobCount: jobs.length, dayList: digestDayList(jobs) });
  const email = buildReminderDigestEmail(context.settings, { kind: "scheduled", jobs, texts, actionUrl: resolveAppUrl("/cleaner/jobs") });
  const jobIds = jobs.map((job) => job.jobId);
  const result = await sendEmailDetailed({ kind: "job_reminder",
    to: batch.email,
    subject: email.subject,
    html: email.html,
    safeguard: {
      typeKey: SCHEDULED_REMINDER_TYPE_KEY,
      entityKey: combinedReminderEntityKey(batch.email, jobIds),
      relatedEntityKeys: jobIds.map((jobId) => `Job:${jobId}`),
    },
  });
  return { result, orderedJobs: jobs };
}

/**
 * Sends the 24-hour reminder emails for the claimed jobs: ONE email per
 * cleaner. A cleaner with one job gets that job's usual reminder; a cleaner
 * with several gets one combined email listing all of them. The outcome is
 * kept per job: a job counts as reached/delivered when any of its cleaners'
 * emails did, exactly as when each job had its own email.
 */
async function sendLongReminderEmails(jobs: readonly LongReminderJob[], context: SendLongContext): Promise<Map<string, JobEmailOutcome>> {
  const outcomes = new Map<string, JobEmailOutcome>(jobs.map((job) => [job.id, { delivered: false, reachedProvider: false }]));
  const batches = groupJobsByCleaner(jobs, context.recipients);
  let wording: WordingRenderer | null = null;

  for (const batch of batches) {
    let sent: { result: EmailSendResult; covered: LongReminderJob[]; combinedEmail?: ReminderRecipientResult["combinedEmail"] };
    if (batch.jobs.length === 1) {
      sent = { result: await sendSingleJobReminderEmail(batch, batch.jobs[0], context.settings), covered: batch.jobs };
    } else {
      wording ??= await loadNotificationWording(SCHEDULED_REMINDER_TYPE_KEY);
      const combined = await sendCombinedReminderEmail(batch, context, wording);
      const order = new Map(combined.orderedJobs.map((job, index) => [job.jobId, index]));
      sent = {
        result: combined.result,
        covered: [...batch.jobs].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
        combinedEmail: {
          id: combinedReminderEntityKey(batch.email, combined.orderedJobs.map((job) => job.jobId)),
          jobCount: combined.orderedJobs.length,
          jobNumbers: combined.orderedJobs.map((job) => job.jobReference),
        },
      };
    }
    const combinedEmail = sent.combinedEmail;
    const covered = sent.covered;
    const ok = sent.result.ok;
    const reached = emailReachedProvider(sent.result);
    for (const job of covered) {
      const outcome = outcomes.get(job.id)!;
      outcome.delivered = outcome.delivered || ok;
      outcome.reachedProvider = outcome.reachedProvider || reached;
      context.recipients.push({
        jobId: job.id,
        jobNumber: getJobReference(job),
        propertyName: job.property.name,
        recipient: batch.displayName,
        contact: batch.email,
        channel: "email",
        status: ok ? "sent" : sent.result.skipped ? "skipped" : "failed",
        error: ok ? undefined : sent.result.error ?? "Email provider rejected the send",
        ...(combinedEmail ? { combinedEmail } : {}),
      });
    }
  }
  return outcomes;
}

export async function dispatchJobReminders(options: DispatchJobRemindersOptions = {}) {
  const now = options.now ?? new Date();
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";

  const summary = {
    longCandidates: 0,
    longSent: 0,
    longMode: "window" as "window" | "next-date",
    longTargetDate: null as string | null,
    shortCandidates: 0,
    shortSent: 0,
    shortMode: "window" as "window" | "next-date",
    shortTargetDate: null as string | null,
    shortNoPhone: 0,
    shortFailed: 0,
    skipped: [] as string[],
    recipients: [] as ReminderRecipientResult[],
  };

  if ((options.reminderType === "LONG" || options.reminderType === "ALL" || !options.reminderType)) {
    if (!settings.scheduledNotifications.reminder24hEnabled && !options.ignoreEnabled) {
      summary.skipped.push("24-hour reminders are disabled in settings.");
    } else {
      const jobsLong = await db.job.findMany({
        where: {
          scheduledDate: {
            gte: new Date(now.getTime() - 24 * 3600_000),
            lte: new Date(now.getTime() + 72 * 3600_000),
          },
          status: { in: ["ASSIGNED"] },
          ...(options.force ? {} : { reminder24hSent: false }),
        },
        select: {
          id: true,
          jobNumber: true,
          jobType: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          endTime: true,
          internalNotes: true,
          property: { select: { name: true, address: true } },
          assignments: {
            where: { removedAt: null, user: { isActive: true } },
            select: { user: { select: { name: true, email: true } } },
          },
        },
      });

      let effectiveJobsLong = jobsLong.filter((job) =>
        isInsideReminderWindow(resolveScheduledAt(job, timezone), now, Math.max(1, settings.reminder24hHours))
      );
      if (effectiveJobsLong.length === 0 && options.force && options.useNextAvailableDate !== false) {
        const nextScheduledDate = await findNextScheduledDate(now);
        if (nextScheduledDate) {
          const range = toUtcDayRange(nextScheduledDate);
          effectiveJobsLong = await db.job.findMany({
            where: {
              scheduledDate: { gte: range.start, lt: range.end },
              status: { in: ["ASSIGNED"] },
              ...(options.force ? {} : { reminder24hSent: false }),
            },
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              scheduledDate: true,
              startTime: true,
              dueTime: true,
              endTime: true,
              internalNotes: true,
              property: { select: { name: true, address: true } },
              assignments: {
                where: { removedAt: null },
                select: { user: { select: { name: true, email: true } } },
              },
            },
            orderBy: { scheduledDate: "asc" },
          });
          summary.longMode = "next-date";
          summary.longTargetDate = range.start.toISOString().slice(0, 10);
        }
      }

      summary.longCandidates = effectiveJobsLong.length;

      // Claim BEFORE sending: a sweep that sent and then failed to record it
      // (or a provider answer that was not a clear yes) used to leave the job
      // unflagged, and every 30-minute tick emailed the cleaners again. Every
      // job of this run is claimed first so each cleaner can get ONE email
      // listing all of their jobs (owner, 2026-11-17); a concurrent tick claims
      // none of them again.
      const claimedJobs: LongReminderJob[] = [];
      for (const job of effectiveJobsLong) {
        if (!options.force && !(await claimReminder(job.id, "reminder24hSent"))) continue;
        claimedJobs.push(job);
      }

      const outcomes = await sendLongReminderEmails(claimedJobs, { settings, timezone, recipients: summary.recipients });

      for (const job of claimedJobs) {
        const outcome = outcomes.get(job.id) ?? { delivered: false, reachedProvider: false };
        if (!options.force && !outcome.reachedProvider) {
          // Nothing reached a provider for this job (switched off, no key,
          // refused before sending): release the claim so a later tick may try.
          await releaseReminder(job.id, "reminder24hSent");
        }
        if (outcome.delivered) {
          summary.longSent += 1;
          if (options.force) await db.job.update({ where: { id: job.id }, data: { reminder24hSent: true } });
          // Client-facing pre-clean reminder — one send per job, tied to the same
          // 24h pass + reminder24hSent gate as the cleaner reminder so it never
          // spams. Best-effort auto send (gated + never throws).
          await sendLifecycleEmail({ jobId: job.id, stage: "REMINDER", mode: "auto" }).catch(() => {});
        }
      }
    }
  }

  if ((options.reminderType === "SHORT" || options.reminderType === "ALL" || !options.reminderType)) {
    if (!settings.scheduledNotifications.reminder2hEnabled && !options.ignoreEnabled) {
      summary.skipped.push("2-hour reminders are disabled in settings.");
    } else {
      const jobsShort = await db.job.findMany({
        where: {
          scheduledDate: {
            gte: new Date(now.getTime() - 24 * 3600_000),
            lte: new Date(now.getTime() + 48 * 3600_000),
          },
          status: { in: ["ASSIGNED"] },
          ...(options.force ? {} : { reminder2hSent: false }),
        },
        select: {
          id: true,
          jobType: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          endTime: true,
          internalNotes: true,
          property: { select: { name: true, address: true } },
          assignments: {
            where: { removedAt: null, user: { isActive: true } },
            select: { user: { select: { name: true, phone: true } } },
          },
        },
      });

      let effectiveJobsShort = jobsShort.filter((job) =>
        isInsideReminderWindow(resolveScheduledAt(job, timezone), now, Math.max(1, settings.reminder2hHours))
      );
      if (effectiveJobsShort.length === 0 && options.force && options.useNextAvailableDate !== false) {
        const nextScheduledDate = await findNextScheduledDate(now);
        if (nextScheduledDate) {
          const range = toUtcDayRange(nextScheduledDate);
          effectiveJobsShort = await db.job.findMany({
            where: {
              scheduledDate: { gte: range.start, lt: range.end },
              status: { in: ["ASSIGNED"] },
              ...(options.force ? {} : { reminder2hSent: false }),
            },
            select: {
              id: true,
              jobType: true,
              scheduledDate: true,
              startTime: true,
              dueTime: true,
              endTime: true,
              internalNotes: true,
              property: { select: { name: true, address: true } },
              assignments: {
                where: { removedAt: null },
                select: { user: { select: { name: true, phone: true } } },
              },
            },
            orderBy: { scheduledDate: "asc" },
          });
          summary.shortMode = "next-date";
          summary.shortTargetDate = range.start.toISOString().slice(0, 10);
        }
      }

      summary.shortCandidates = effectiveJobsShort.length;
      const smsWording = await loadNotificationWording(SCHEDULED_REMINDER_TYPE_KEY);

      for (const job of effectiveJobsShort) {
        if (!options.force && !(await claimReminder(job.id, "reminder2hSent"))) continue;
        const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
        let delivered = false;
        let reachedProvider = false;
        const jobRefShort = getJobReference(job);
        for (const assignment of job.assignments) {
          const displayName = assignment.user.name ?? assignment.user.phone ?? "Team member";
          if (!assignment.user.phone) {
            summary.shortNoPhone += 1;
            summary.recipients.push({
              jobId: job.id,
              jobNumber: jobRefShort,
              propertyName: job.property.name,
              recipient: displayName,
              contact: "",
              channel: "sms",
              status: "skipped",
              error: "No phone on file",
            });
            continue;
          }
          const result = await sendSmsDetailed(assignment.user.phone, scheduledReminderSms(smsWording, job, timingText), undefined, { typeKey: SCHEDULED_REMINDER_TYPE_KEY, entityKey: `Job:${job.id}` });
          delivered = delivered || result.ok;
          reachedProvider = reachedProvider || result.ok || result.status === "failed" || result.status === "suppressed";
          if (!result.ok) {
            summary.shortFailed += 1;
          }
          summary.recipients.push({
            jobId: job.id,
            jobNumber: jobRefShort,
            propertyName: job.property.name,
            recipient: displayName,
            contact: assignment.user.phone,
            channel: "sms",
            status: result.ok ? "sent" : "failed",
            error: result.ok ? undefined : result.error ?? "SMS provider rejected the send",
          });
        }
        if (!options.force && !reachedProvider) await releaseReminder(job.id, "reminder2hSent");
        if (delivered) {
          summary.shortSent += 1;
          if (options.force) await db.job.update({ where: { id: job.id }, data: { reminder2hSent: true } });
        }
      }
    }
  }

  logger.info({ ...summary, force: Boolean(options.force) }, "Reminder dispatch run complete");
  return summary;
}

/**
 * Resend a single job's reminder to its assigned cleaners on one channel — used
 * by the admin "Resend" action so a single failed recipient can be retried
 * without re-blasting the whole batch.
 */
export async function resendJobReminder(
  jobId: string,
  channel: "email" | "sms"
): Promise<{ recipients: ReminderRecipientResult[] }> {
  const settings = await getAppSettings();
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      endTime: true,
      internalNotes: true,
      property: { select: { name: true, address: true } },
      assignments: {
        where: { removedAt: null, user: { isActive: true } },
        select: { user: { select: { name: true, email: true, phone: true } } },
      },
    },
  });
  if (!job) throw new Error("Job not found.");

  const jobRef = getJobReference(job);
  const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
  const recipients: ReminderRecipientResult[] = [];

  for (const assignment of job.assignments) {
    const displayName = assignment.user.name ?? assignment.user.email ?? assignment.user.phone ?? "Team member";
    if (channel === "email") {
      if (!assignment.user.email) {
        recipients.push({
          jobId: job.id, jobNumber: jobRef, propertyName: job.property.name,
          recipient: displayName, contact: "", channel: "email", status: "skipped", error: "No email on file",
        });
        continue;
      }
      const emailTemplate = renderEmailTemplate(settings, "jobReminder24h", {
        userName: displayName,
        jobType: job.jobType.replace(/_/g, " "),
        propertyName: job.property.name,
        propertyAddress: job.property.address,
        when: job.startTime ?? "Time TBD",
        timingFlags: timingText || "No special timing notes",
        jobNumber: jobRef,
        jobUrl: "/cleaner/jobs",
        actionUrl: "/cleaner/jobs",
        actionLabel: "Open jobs",
      });
      const res = await sendEmailDetailed({ kind: "job_reminder",
        to: assignment.user.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
      });
      recipients.push({
        jobId: job.id, jobNumber: jobRef, propertyName: job.property.name,
        recipient: displayName, contact: assignment.user.email, channel: "email",
        status: res.ok ? "sent" : "failed",
        error: res.ok ? undefined : res.error ?? "Email provider rejected the send",
      });
    } else {
      if (!assignment.user.phone) {
        recipients.push({
          jobId: job.id, jobNumber: jobRef, propertyName: job.property.name,
          recipient: displayName, contact: "", channel: "sms", status: "skipped", error: "No phone on file",
        });
        continue;
      }
      const res = await sendSmsDetailed(assignment.user.phone, scheduledReminderSms(await loadNotificationWording(SCHEDULED_REMINDER_TYPE_KEY), job, timingText));
      recipients.push({
        jobId: job.id, jobNumber: jobRef, propertyName: job.property.name,
        recipient: displayName, contact: assignment.user.phone, channel: "sms",
        status: res.ok ? "sent" : "failed",
        error: res.ok ? undefined : res.error ?? "SMS provider rejected the send",
      });
    }
  }

  return { recipients };
}
