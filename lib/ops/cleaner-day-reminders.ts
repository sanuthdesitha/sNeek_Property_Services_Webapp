import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getJobReference } from "@/lib/jobs/job-number";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
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

  const wording = await loadNotificationWording("job.cleaner_day_reminder");
  for (const job of jobs) {
    const scheduledAt = resolveScheduledAt(job, timezone);
    const within2h = now.getTime() >= scheduledAt.getTime() - leadMs;
    const pastMorning = now.getTime() >= morningUnlock.getTime();
    if (!within2h && !pastMorning) continue; // too early — wait for 6AM or the 2h window

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
    const { title: subject, body } = wording.render("cleaner", "INBOX", values);
    const email = wording.render("cleaner", "EMAIL", values);
    const smsBody = wording.render("cleaner", "SMS", values).body;
    const emailHtml = email.html;

    for (const assignment of job.assignments) {
      const cleaner = assignment.user;
      // De-dup: already reminded for this job today?
      const already = await db.notification.findFirst({
        where: { userId: cleaner.id, jobId: job.id, subject, sentAt: { gte: dayStart } },
        select: { id: true },
      });
      if (already) {
        skipped += 1;
        continue;
      }

      const attempted = await dispatchNotificationOnce({
        event: "cleaner.day_reminder", day: dayKey, recipientId: cleaner.id, jobId: job.id,
      }, async () => { await deliverNotificationToRecipients({
        recipients: [
          { id: cleaner.id, role: cleaner.role, email: cleaner.email, phone: cleaner.phone, name: cleaner.name },
        ],
        category: "jobs",
        jobId: job.id,
        web: { subject, body },
        url: "/cleaner/jobs",
        email: { subject: email.subject, html: emailHtml, logBody: body },
        sms: smsBody,
      }); }, now);
      if (attempted) sent += 1;
      else skipped += 1;
    }
  }

  logger.info({ jobs: jobs.length, sent, skipped, day: dayKey }, "Cleaner day reminders dispatched");
  return { jobs: jobs.length, sent, skipped };
}
