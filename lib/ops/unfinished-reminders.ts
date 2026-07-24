import { JobStatus, NotificationChannel, NotificationStatus } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

/**
 * Daily push-only nudge for genuinely stale unfinished jobs: PAUSED or
 * IN_PROGRESS with a scheduledDate before today (Sydney). No email — the
 * admin "Send reminder" button covers deliberate escalation; this is the
 * quiet automatic version. De-duped once per job per day via a
 * JOB_UNFINISHED_PUSH_REMINDER audit-row lookback.
 */
const TZ = "Australia/Sydney";
const DEDUP_LOOKBACK_HOURS = 20;
const MAX_JOBS_PER_RUN = 50;

export async function dispatchUnfinishedJobPushReminders(now = new Date()) {
  // Start of today in Sydney, expressed as a UTC instant boundary on the
  // stored scheduledDate (dates are stored as UTC midnight day keys).
  const zoned = toZonedTime(now, TZ);
  const todayStart = new Date(Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()));

  const jobs = await db.job.findMany({
    where: {
      status: { in: [JobStatus.PAUSED, JobStatus.IN_PROGRESS] },
      scheduledDate: { lt: todayStart },
    },
    orderBy: { scheduledDate: "asc" },
    take: MAX_JOBS_PER_RUN,
    select: {
      id: true,
      jobNumber: true,
      status: true,
      scheduledDate: true,
      property: { select: { name: true } },
      assignments: {
        where: { removedAt: null, user: { isActive: true } },
        select: { userId: true },
      },
    },
  });
  if (jobs.length === 0) return { reminded: 0, skipped: 0 };

  // One reminder per job per day: skip jobs already reminded in the lookback.
  const lookback = new Date(now.getTime() - DEDUP_LOOKBACK_HOURS * 60 * 60 * 1000);
  const recent = await db.auditLog.findMany({
    where: {
      action: "JOB_UNFINISHED_PUSH_REMINDER",
      jobId: { in: jobs.map((j) => j.id) },
      createdAt: { gte: lookback },
    },
    select: { jobId: true },
  });
  const alreadyReminded = new Set(recent.map((row) => row.jobId));

  let reminded = 0;
  let skipped = 0;
  for (const job of jobs) {
    if (alreadyReminded.has(job.id) || job.assignments.length === 0) {
      skipped += 1;
      continue;
    }
    const propertyName = job.property?.name ?? "your job";
    const body = `${job.jobNumber || job.id}: ${propertyName} is still unfinished (${
      job.status === JobStatus.PAUSED ? "paused" : "in progress"
    }). Please open it and submit your checklist.`;

    try {
      for (const assignment of job.assignments) {
        await db.notification.create({
          data: {
            userId: assignment.userId,
            jobId: job.id,
            channel: NotificationChannel.PUSH,
            subject: "Unfinished job reminder",
            body,
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
        await sendWebPushToUser(assignment.userId, {
          title: "Unfinished job reminder",
          body,
          url: "/cleaner/jobs",
          tag: `job-unfinished-${job.id}`,
        });
      }
      // Audit doubles as the dedup marker (userId FK → attribute to the first
      // assignee, same convention as the auto-pause sweep).
      await db.auditLog.create({
        data: {
          userId: job.assignments[0].userId,
          jobId: job.id,
          action: "JOB_UNFINISHED_PUSH_REMINDER",
          entity: "Job",
          entityId: job.id,
          after: { cleanerIds: job.assignments.map((a) => a.userId), status: job.status } as any,
        },
      });
      reminded += 1;
    } catch (err) {
      logger.error({ err, jobId: job.id }, "[unfinished-reminders] push reminder failed");
    }
  }

  logger.info({ reminded, skipped }, "[unfinished-reminders] run complete");
  return { reminded, skipped };
}
