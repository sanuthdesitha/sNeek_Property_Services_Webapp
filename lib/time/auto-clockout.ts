import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { resolveClockRuleForLog } from "@/lib/time/clock-rules";

export async function autoClockOutStaleTimeLogsForUser(userId: string) {
  const settings = await getAppSettings();
  if (!settings.autoClockOut.enabled) return 0;
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
          estimatedHours: true,
        },
      },
    },
  });

  let changed = 0;
  const now = new Date();

  for (const log of openLogs) {
    const priorTime = await db.timeLog.aggregate({
      where: {
        jobId: log.jobId,
        userId,
        id: { not: log.id },
        stoppedAt: { not: null },
      },
      _sum: { durationM: true },
    });
    const completedDurationMinutes = Math.max(0, priorTime._sum.durationM ?? 0);
    const clockRule = resolveClockRuleForLog({
      job: {
        scheduledDate: log.job.scheduledDate,
        dueTime: log.job.dueTime,
        endTime: log.job.endTime,
        estimatedHours: log.job.estimatedHours,
      },
      startedAt: log.startedAt,
      settings,
      completedDurationMinutes,
    });
    const cutoff = clockRule.cutoffAt;
    if (!cutoff) continue;
    if (now < cutoff) continue;

    const stoppedAt = cutoff > log.startedAt ? cutoff : now;
    const durationM = Math.max(0, Math.round((stoppedAt.getTime() - log.startedAt.getTime()) / 60000));

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
