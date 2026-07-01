import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getJobReference } from "@/lib/jobs/job-number";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";

/**
 * High-alert day-of reminder to the ASSIGNED cleaner(s) for each job scheduled
 * today. Fires from ~6AM Sydney (or as soon as we're within 2h of a job's start
 * time, whichever comes first) so an early job still gets its heads-up. Delivery
 * goes out on every channel the cleaner has enabled (web push, email, SMS) via
 * the shared notification pipeline, which honours each cleaner's preferences.
 *
 * De-duped by the notification subject: once a cleaner has a reminder logged for
 * this job today, we don't send again — so repeated scheduler ticks are safe.
 */

const MORNING_HOUR = 6; // Sydney hour the morning reminder unlocks.
const LEAD_MS = 2 * 3_600_000; // Also send once we're within 2h of start.

function resolveScheduledAt(
  job: { scheduledDate: Date; startTime?: string | null; dueTime?: string | null; endTime?: string | null },
  timezone: string,
): Date {
  const localDate = toZonedTime(job.scheduledDate, timezone);
  const datePart = format(localDate, "yyyy-MM-dd");
  const timeValue = job.startTime || job.dueTime || job.endTime || "09:00";
  const safeTime = /^\d{2}:\d{2}$/.test(timeValue) ? timeValue : "09:00";
  return fromZonedTime(`${datePart}T${safeTime}:00`, timezone);
}

export async function dispatchCleanerDayReminders(now: Date = new Date()) {
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";

  const zonedNow = toZonedTime(now, timezone);
  const dayKey = format(zonedNow, "yyyy-MM-dd");
  const dayStart = fromZonedTime(`${dayKey}T00:00:00`, timezone);
  const dayEnd = fromZonedTime(`${dayKey}T23:59:59`, timezone);
  const morningUnlock = fromZonedTime(`${dayKey}T${String(MORNING_HOUR).padStart(2, "0")}:00:00`, timezone);

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
        where: { removedAt: null, user: { isActive: true, role: Role.CLEANER } },
        select: { user: { select: { id: true, name: true, email: true, phone: true, role: true } } },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
  });

  let sent = 0;
  let skipped = 0;

  for (const job of jobs) {
    const scheduledAt = resolveScheduledAt(job, timezone);
    const within2h = now.getTime() >= scheduledAt.getTime() - LEAD_MS;
    const pastMorning = now.getTime() >= morningUnlock.getTime();
    if (!within2h && !pastMorning) continue; // too early — wait for 6AM or the 2h window

    const jobRef = getJobReference(job);
    const timing = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
    const whenLabel = job.startTime || job.dueTime || "today";
    const subject = `Today's job: ${job.property.name} (${jobRef})`;
    const body = `You're rostered at ${job.property.name} today at ${whenLabel}. ${job.property.address}${
      timing ? ` — ${timing}` : ""
    }`;
    const smsBody = `sNeek Ops: Today at ${whenLabel} you're cleaning ${job.property.name} (${jobRef}). ${job.property.address}.${
      timing ? ` ${timing}.` : ""
    }`;
    const emailHtml = `
      <div style="font-family:Arial,sans-serif;color:#111;">
        <h2 style="margin:0 0 6px;">Your job today</h2>
        <p style="margin:0 0 10px;color:#555;">${subject}</p>
        <table style="font-size:14px;border-collapse:collapse;">
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Property</td><td><strong>${job.property.name}</strong></td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Address</td><td>${job.property.address}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Start</td><td>${whenLabel}</td></tr>
          <tr><td style="padding:2px 10px 2px 0;color:#666;">Job</td><td>${job.jobType.replace(/_/g, " ")} · ${jobRef}</td></tr>
          ${timing ? `<tr><td style="padding:2px 10px 2px 0;color:#666;">Notes</td><td>${timing}</td></tr>` : ""}
        </table>
        <p style="margin:16px 0;">
          <a href="/cleaner/jobs" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Open my jobs</a>
        </p>
      </div>`;

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

      await deliverNotificationToRecipients({
        recipients: [
          { id: cleaner.id, role: cleaner.role, email: cleaner.email, phone: cleaner.phone, name: cleaner.name },
        ],
        category: "jobs",
        jobId: job.id,
        web: { subject, body },
        url: "/cleaner/jobs",
        email: { subject, html: emailHtml, logBody: body },
        sms: smsBody,
      });
      sent += 1;
    }
  }

  logger.info({ jobs: jobs.length, sent, skipped, day: dayKey }, "Cleaner day reminders dispatched");
  return { jobs: jobs.length, sent, skipped };
}
