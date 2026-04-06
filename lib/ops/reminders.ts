import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { renderEmailTemplate } from "@/lib/email-templates";
import { getJobReference } from "@/lib/jobs/job-number";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { getAppSettings } from "@/lib/settings";

export interface DispatchJobRemindersOptions {
  now?: Date;
  reminderType?: "LONG" | "SHORT" | "ALL";
  force?: boolean;
  ignoreEnabled?: boolean;
  useNextAvailableDate?: boolean;
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

      for (const job of effectiveJobsLong) {
        const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ") || "No special timing notes";
        let delivered = false;
        for (const assignment of job.assignments) {
          if (!assignment.user.email) continue;
          const emailTemplate = renderEmailTemplate(settings, "jobReminder24h", {
            userName: assignment.user.name ?? assignment.user.email ?? "Team member",
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
          const ok = await sendEmail({
            to: assignment.user.email,
            subject: emailTemplate.subject,
            html: emailTemplate.html,
          });
          delivered = delivered || ok;
        }
        if (delivered) {
          summary.longSent += 1;
          await db.job.update({ where: { id: job.id }, data: { reminder24hSent: true } });
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
            where: { removedAt: null },
            select: { user: { select: { phone: true } } },
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
                select: { user: { select: { phone: true } } },
              },
            },
            orderBy: { scheduledDate: "asc" },
          });
          summary.shortMode = "next-date";
          summary.shortTargetDate = range.start.toISOString().slice(0, 10);
        }
      }

      summary.shortCandidates = effectiveJobsShort.length;

      for (const job of effectiveJobsShort) {
        const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
        const timingSuffix = timingText ? ` ${timingText}.` : "";
        let delivered = false;
        for (const assignment of job.assignments) {
          if (!assignment.user.phone) {
            summary.shortNoPhone += 1;
            continue;
          }
          const result = await sendSmsDetailed(
            assignment.user.phone,
            `sNeek Ops: Your cleaning job at ${job.property.name} starts soon (${job.startTime ?? "today"}). ${
              job.property.address
            }.${timingSuffix}`
          );
          delivered = delivered || result.ok;
          if (!result.ok) {
            summary.shortFailed += 1;
          }
        }
        if (delivered) {
          summary.shortSent += 1;
          await db.job.update({ where: { id: job.id }, data: { reminder2hSent: true } });
        }
      }
    }
  }

  logger.info({ ...summary, force: Boolean(options.force) }, "Reminder dispatch run complete");
  return summary;
}
