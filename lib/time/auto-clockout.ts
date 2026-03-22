import { addMinutes, endOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

function localCutoffUtc(scheduledDate: Date, timeValue: string, timezone: string) {
  const scheduledLocal = toZonedTime(scheduledDate, timezone);
  const datePart = scheduledLocal.toISOString().slice(0, 10);
  return fromZonedTime(`${datePart}T${timeValue}:00`, timezone);
}

export async function autoClockOutStaleTimeLogsForUser(userId: string) {
  const settings = await getAppSettings();
  if (!settings.autoClockOut.enabled) return 0;

  const timezone = settings.timezone || "Australia/Sydney";
  const openLogs = await db.timeLog.findMany({
    where: { userId, stoppedAt: null },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          property: { select: { name: true } },
          scheduledDate: true,
          dueTime: true,
          endTime: true,
        },
      },
    },
  });

  let changed = 0;
  const now = new Date();

  for (const log of openLogs) {
    const baseCutoff = log.job.dueTime
      ? localCutoffUtc(log.job.scheduledDate, log.job.dueTime, timezone)
      : log.job.endTime
        ? localCutoffUtc(log.job.scheduledDate, log.job.endTime, timezone)
        : settings.autoClockOut.fallbackAtMidnight
          ? fromZonedTime(endOfDay(toZonedTime(log.job.scheduledDate, timezone)), timezone)
          : null;

    if (!baseCutoff) continue;
    const cutoff = log.job.dueTime || log.job.endTime
      ? addMinutes(baseCutoff, settings.autoClockOut.graceMinutes)
      : baseCutoff;
    if (now < cutoff) continue;

    const stoppedAt = cutoff > log.startedAt ? cutoff : now;
    const durationM = Math.max(1, Math.round((stoppedAt.getTime() - log.startedAt.getTime()) / 60000));

    await db.$transaction([
      db.timeLog.update({
        where: { id: log.id },
        data: {
          stoppedAt,
          durationM,
          notes: [log.notes, "Auto clocked out by system"].filter(Boolean).join(" | "),
        },
      }),
      db.notification.create({
        data: {
          userId,
          jobId: log.jobId,
          channel: NotificationChannel.PUSH,
          subject: "Auto clocked out",
          body: `${log.job.jobNumber || log.job.id}: ${log.job.property.name} was automatically clocked out at ${stoppedAt.toLocaleTimeString("en-AU", {
            hour: "2-digit",
            minute: "2-digit",
          })}.`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      }),
      db.auditLog.create({
        data: {
          userId,
          jobId: log.jobId,
          action: "AUTO_CLOCK_OUT",
          entity: "TimeLog",
          entityId: log.id,
          after: {
            stoppedAt: stoppedAt.toISOString(),
            durationM,
          } as any,
        },
      }),
    ]);
    changed += 1;
  }

  return changed;
}
