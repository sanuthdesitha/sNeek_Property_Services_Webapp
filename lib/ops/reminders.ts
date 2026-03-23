import { db } from "@/lib/db";
import { getJobTimingHighlights, parseJobInternalNotes } from "@/lib/jobs/meta";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/notifications/email";
import { sendSms } from "@/lib/notifications/sms";
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

  const summary = {
    longCandidates: 0,
    longSent: 0,
    longMode: "window" as "window" | "next-date",
    longTargetDate: null as string | null,
    shortCandidates: 0,
    shortSent: 0,
    shortMode: "window" as "window" | "next-date",
    shortTargetDate: null as string | null,
    skipped: [] as string[],
  };

  if ((options.reminderType === "LONG" || options.reminderType === "ALL" || !options.reminderType)) {
    if (!settings.scheduledNotifications.reminder24hEnabled && !options.ignoreEnabled) {
      summary.skipped.push("24-hour reminders are disabled in settings.");
    } else {
      const longWindowHours = Math.max(1, settings.reminder24hHours);
      const longEnd = new Date(now.getTime() + longWindowHours * 3600_000);
      const longStart = new Date(now.getTime() + (longWindowHours - 1) * 3600_000);

      const jobsLong = await db.job.findMany({
        where: {
          scheduledDate: { gte: longStart, lte: longEnd },
          status: { in: ["ASSIGNED"] },
          ...(options.force ? {} : { reminder24hSent: false }),
        },
        select: {
          id: true,
          jobType: true,
          startTime: true,
          internalNotes: true,
          property: { select: { name: true, address: true } },
          assignments: { select: { user: { select: { name: true, email: true } } } },
        },
      });

      let effectiveJobsLong = jobsLong;
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
              startTime: true,
              internalNotes: true,
              property: { select: { name: true, address: true } },
              assignments: { select: { user: { select: { name: true, email: true } } } },
            },
            orderBy: { scheduledDate: "asc" },
          });
          summary.longMode = "next-date";
          summary.longTargetDate = range.start.toISOString().slice(0, 10);
        }
      }

      summary.longCandidates = effectiveJobsLong.length;

      for (const job of effectiveJobsLong) {
        const timingText = getJobTimingHighlights(parseJobInternalNotes(job.internalNotes)).join(" | ");
        const timingHtml = timingText ? `<p><strong>Timing:</strong> ${timingText}</p>` : "";
        let delivered = false;
        for (const assignment of job.assignments) {
          if (!assignment.user.email) continue;
          const ok = await sendEmail({
            to: assignment.user.email,
            subject: `Reminder: Cleaning job soon - ${job.property.name}`,
            html: `<p>Hi ${assignment.user.name},</p><p>You have a ${job.jobType.replace(
              /_/g,
              " "
            )} job coming up at <strong>${job.property.name}</strong>, ${job.property.address}.</p><p>Start time: ${
              job.startTime ?? "TBD"
            }</p>${timingHtml}`,
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
      const shortWindowHours = Math.max(1, settings.reminder2hHours);
      const shortEnd = new Date(now.getTime() + shortWindowHours * 3600_000);
      const shortStart = new Date(now.getTime() + (shortWindowHours - 1) * 3600_000);

      const jobsShort = await db.job.findMany({
        where: {
          scheduledDate: { gte: shortStart, lte: shortEnd },
          status: { in: ["ASSIGNED"] },
          ...(options.force ? {} : { reminder2hSent: false }),
        },
        select: {
          id: true,
          jobType: true,
          startTime: true,
          internalNotes: true,
          property: { select: { name: true, address: true } },
          assignments: { select: { user: { select: { phone: true } } } },
        },
      });

      let effectiveJobsShort = jobsShort;
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
              startTime: true,
              internalNotes: true,
              property: { select: { name: true, address: true } },
              assignments: { select: { user: { select: { phone: true } } } },
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
          if (!assignment.user.phone) continue;
          const ok = await sendSms(
            assignment.user.phone,
            `sNeek Ops: Your cleaning job at ${job.property.name} starts soon (${job.startTime ?? "today"}). ${
              job.property.address
            }.${timingSuffix}`
          );
          delivered = delivered || ok;
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
