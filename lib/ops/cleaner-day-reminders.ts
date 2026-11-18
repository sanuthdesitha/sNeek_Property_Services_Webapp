import { claimNotificationDispatch, finishNotificationDispatch, type DispatchClaim } from "@/lib/notifications/dispatch-once";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getJobReference } from "@/lib/jobs/job-number";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { logger } from "@/lib/logger";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";
import { reminderDigestTexts } from "@/lib/notifications/wording/reminder-digest";
import { buildReminderDigestEmail, digestDayList, sortDigestJobs, type ReminderDigestJob } from "@/lib/email-design/reminder-digest";
import { resolveAppUrl } from "@/lib/app-url";
import { combinedReminderEntityKey, toDigestJob } from "@/lib/ops/reminder-digest-jobs";
import { DAY_REMINDER_LEAD_HOURS, DAY_REMINDER_UNLOCK_HOUR, REMINDER_DEFAULT_JOB_TIME } from "@/lib/scheduling-rules/constants";

/**
 * High-alert day-of reminder to the ASSIGNED cleaner(s) for each job scheduled
 * today. Fires from ~6AM Sydney (or as soon as we're within 2h of a job's start
 * time, whichever comes first) so an early job still gets its heads-up. Delivery
 * goes out on every channel the cleaner has enabled (web push, email, SMS) via
 * the shared notification pipeline, which honours each cleaner's preferences.
 *
 * A unique committed receipt per cleaner/job/local day claims the entire
 * multi-channel attempt before delivery. Concurrent ticks cannot send twice.
 *
 * When one run has several jobs for the same cleaner (typically the 6 AM
 * run), the EMAIL is one message listing all of them (owner, 2026-11-17);
 * push and SMS stay one per job. Every job's receipt is claimed before that
 * email is sent, so a job already reminded is never listed again.
 */

const MORNING_HOUR = DAY_REMINDER_UNLOCK_HOUR; // Sydney hour the morning reminder unlocks.
const LEAD_MS = DAY_REMINDER_LEAD_HOURS * 3_600_000; // Also send once we're within 2h of start.

function resolveScheduledAt(
  job: { scheduledDate: Date; startTime?: string | null; dueTime?: string | null; endTime?: string | null },
  timezone: string,
): Date {
  const localDate = toZonedTime(job.scheduledDate, timezone);
  const datePart = format(localDate, "yyyy-MM-dd");
  const timeValue = job.startTime || job.dueTime || job.endTime || REMINDER_DEFAULT_JOB_TIME;
  const safeTime = /^\d{2}:\d{2}$/.test(timeValue) ? timeValue : REMINDER_DEFAULT_JOB_TIME;
  return fromZonedTime(`${datePart}T${safeTime}:00`, timezone);
}

const DAY_REMINDER_TYPE_KEY = "job.cleaner_day_reminder";

type DayReminderJob = {
  id: string;
  jobNumber: string | null;
  jobType: string;
  scheduledDate: Date;
  startTime: string | null;
  dueTime: string | null;
  endTime: string | null;
  internalNotes: string | null;
  property: { name: string; address: string };
};

type DayReminderCleaner = { id: string; name: string | null; email: string | null; phone: string | null; role: Role };

/** One job's day-of reminder, rendered once for every cleaner on it. */
type DayReminderMessage = {
  job: DayReminderJob;
  inbox: { subject: string; body: string };
  email: { subject: string; html: string };
  smsBody: string;
  digestJob: ReminderDigestJob;
};

type CleanerDayBatch = { cleaner: DayReminderCleaner; items: DayReminderMessage[] };
type ClaimedDayReminder = { item: DayReminderMessage; claim: DispatchClaim };
type DayEmailContext = { wording: WordingRenderer; settings: AppSettings };

function dayReminderMessage(job: DayReminderJob, wording: WordingRenderer, timezone: string): DayReminderMessage {
  const jobRef = getJobReference(job);
  const timing = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
  const whenLabel = job.startTime || job.dueTime || "today";
  const timingValues = { timingFlags: timing };
  const values = {
    propertyName: job.property.name,
    jobNumber: jobRef,
    when: whenLabel,
    propertyAddress: job.property.address,
    jobType: job.jobType.replace(/_/g, " "),
    timingDash: wording.line("timing-dash", "INBOX", timingValues, Boolean(timing)),
    timingSuffix: wording.line("timing-line", "SMS", timingValues, Boolean(timing)),
    timingRow: wording.line("timing-row", "EMAIL", timingValues, Boolean(timing)),
  };
  const { title, body } = wording.render("cleaner", "INBOX", values);
  const email = wording.render("cleaner", "EMAIL", values);
  return {
    job,
    inbox: { subject: title, body },
    email: { subject: email.subject, html: email.html },
    smsBody: wording.render("cleaner", "SMS", values).body,
    digestJob: toDigestJob(job, { timezone, defaultTime: REMINDER_DEFAULT_JOB_TIME, timeLabel: whenLabel }),
  };
}

function deliveryRecipient(cleaner: DayReminderCleaner) {
  return { id: cleaner.id, role: cleaner.role, email: cleaner.email, phone: cleaner.phone, name: cleaner.name };
}

/** One job's reminder on the channels asked for (all three, or push and SMS when the email is combined). */
async function deliverJobDayReminder(cleaner: DayReminderCleaner, item: DayReminderMessage, includeEmail: boolean) {
  await deliverNotificationToRecipients({
    recipients: [deliveryRecipient(cleaner)],
    category: "jobs",
    typeKey: DAY_REMINDER_TYPE_KEY,
    jobId: item.job.id,
    web: item.inbox,
    url: "/cleaner/jobs",
    email: includeEmail ? { subject: item.email.subject, html: item.email.html, logBody: item.inbox.body } : null,
    sms: item.smsBody,
    ...(includeEmail ? {} : { channels: { web: true, sms: true } }),
  });
}

/** ONE email listing every claimed job of this cleaner (email transport only; preferences still apply). */
async function deliverCombinedDayEmail(cleaner: DayReminderCleaner, items: readonly DayReminderMessage[], context: DayEmailContext) {
  const jobs = sortDigestJobs(items.map((item) => item.digestJob));
  const texts = reminderDigestTexts(context.wording, { userName: cleaner.name ?? cleaner.email ?? "there", jobCount: jobs.length, dayList: digestDayList(jobs) });
  const email = buildReminderDigestEmail(context.settings, { kind: "day", jobs, texts, actionUrl: resolveAppUrl("/cleaner/jobs") });
  const jobIds = jobs.map((job) => job.jobId);
  await deliverNotificationToRecipients({
    recipients: [deliveryRecipient(cleaner)],
    category: "jobs",
    typeKey: DAY_REMINDER_TYPE_KEY,
    jobId: null,
    web: { subject: email.subject, body: email.subject },
    url: "/cleaner/jobs",
    email: { subject: email.subject, html: email.html, logBody: `Combined day reminder (${jobs.length} jobs): ${jobs.map((job) => job.jobReference).join(", ")}` },
    channels: { email: true },
    safeguardSubject: {
      entityKey: combinedReminderEntityKey(cleaner.id, jobIds),
      relatedEntityKeys: jobIds.map((jobId) => `Job:${jobId}`),
    },
  });
}

/**
 * Sends a cleaner's claimed day-of reminders. One job: exactly as before (its
 * push, email and SMS). Several jobs in the same run: push and SMS stay one
 * per job (short and time-specific), and the email is ONE message listing
 * them all. Every receipt is ATTEMPTED once the sends return; if they throw,
 * every receipt of this cleaner's run is kept UNCERTAIN and not retried
 * (some channels may already have gone), as for a single job.
 */
async function deliverClaimedDayReminders(cleaner: DayReminderCleaner, claimed: readonly ClaimedDayReminder[], context: DayEmailContext) {
  try {
    if (claimed.length === 1) {
      await deliverJobDayReminder(cleaner, claimed[0].item, true);
    } else {
      for (const { item } of claimed) await deliverJobDayReminder(cleaner, item, false);
      await deliverCombinedDayEmail(cleaner, claimed.map(({ item }) => item), context);
    }
    for (const { claim } of claimed) await finishNotificationDispatch(claim, "ATTEMPTED");
  } catch (error) {
    for (const { claim } of claimed) await finishNotificationDispatch(claim, "UNCERTAIN");
    throw error;
  }
}

/** `rules`: the published scheduling rules the worker passes; default the original 6 AM / 2 hours. */
export async function dispatchCleanerDayReminders(
  now: Date = new Date(),
  rules?: { dayReminderUnlockHour: number; dayReminderLeadHours: number },
) {
  const unlockHour = rules?.dayReminderUnlockHour ?? MORNING_HOUR;
  const leadMs = rules ? rules.dayReminderLeadHours * 3_600_000 : LEAD_MS;
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";

  const zonedNow = toZonedTime(now, timezone);
  const dayKey = format(zonedNow, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${dayKey}T00:00:00`, timezone);
  const dayEnd = fromZonedTime(`${dayKey}T23:59:59`, timezone);
  const morningUnlock = fromZonedTime(`${dayKey}T${String(unlockHour).padStart(2, "0")}:00:00`, timezone);

  const jobs = await db.job.findMany({
    where: {
      scheduledDate: { gte: dayStart, lte: dayEnd },
      status: { in: ["ASSIGNED"] },
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
        where: { removedAt: null, user: { isActive: true, ...holdsRoleWhere(Role.CLEANER) } },
        select: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });

  let sent = 0;
  let skipped = 0;

  const wording = await loadNotificationWording(DAY_REMINDER_TYPE_KEY);
  const byCleaner = new Map<string, CleanerDayBatch>();
  for (const job of jobs) {
    const scheduledAt = resolveScheduledAt(job, timezone);
    const within2h = now.getTime() >= scheduledAt.getTime() - leadMs;
    const pastMorning = now.getTime() >= morningUnlock.getTime();
    if (!within2h && !pastMorning) continue; // too early — wait for 6AM or the 2h window

    const message = dayReminderMessage(job, wording, timezone);
    for (const assignment of job.assignments) {
      const cleaner = assignment.user;
      const batch = byCleaner.get(cleaner.id) ?? { cleaner, items: [] };
      batch.items.push(message);
      byCleaner.set(cleaner.id, batch);
    }
  }

  for (const batch of Array.from(byCleaner.values())) {
    const claimed: ClaimedDayReminder[] = [];
    for (const item of batch.items) {
      // De-dup: already reminded for this job today?
      const already = await db.notification.findFirst({
        where: { userId: batch.cleaner.id, jobId: item.job.id, subject: item.inbox.subject, sentAt: { gte: dayStart } },
        select: { id: true },
      });
      if (already) {
        skipped += 1;
        continue;
      }
      const claim = await claimNotificationDispatch({ event: "cleaner.day_reminder", day: dayKey, recipientId: batch.cleaner.id, jobId: item.job.id }, now);
      if (claim) claimed.push({ item, claim });
      else skipped += 1;
    }
    if (claimed.length === 0) continue;
    await deliverClaimedDayReminders(batch.cleaner, claimed, { wording, settings });
    sent += claimed.length;
  }

  logger.info({ jobs: jobs.length, sent, skipped, day: dayKey }, "Cleaner day reminders dispatched");
  return { jobs: jobs.length, sent, skipped };
}
