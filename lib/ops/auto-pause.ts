import { JobStatus, NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendWebPushToUser } from "@/lib/notifications/web-push";

/**
 * Auto-pause jobs stuck IN_PROGRESS for more than 24 hours.
 *
 * A cleaner who forgets to stop (and slips past auto-clockout — e.g. the job
 * has no cutoff rule) leaves the job "in progress" forever, which the client
 * sees as a live clean. This sweep closes any open TimeLogs exactly the way the
 * manual stop route does (app/api/cleaner/jobs/[id]/stop) and moves the job to
 * PAUSED so it lands back on the admin radar. AutoClockOutSettings cutoff
 * semantics need the full per-log clock-rule resolution, so this sweep uses
 * plain elapsed time when closing logs — the 24h threshold already far exceeds
 * any configured cap.
 */
const STALE_IN_PROGRESS_HOURS = 24;
const MAX_JOBS_PER_RUN = 50;

export type AutoPauseCandidate = {
  status: string;
  /** startedAt of the earliest still-open TimeLog (stoppedAt null), if any. */
  openLogStartedAt: Date | null;
  /** startedAt of the most recent TimeLog (open or closed), if any. */
  latestLogStartedAt: Date | null;
  now: Date;
};

/**
 * Pure decision: does this job qualify for auto-pause?
 * "Running since" = the earliest open TimeLog's startedAt, or — when no log is
 * open — the latest log's startedAt. Only IN_PROGRESS jobs whose running-since
 * instant is more than 24h ago qualify.
 */
export function qualifiesForAutoPause({
  status,
  openLogStartedAt,
  latestLogStartedAt,
  now,
}: AutoPauseCandidate): boolean {
  if (status !== JobStatus.IN_PROGRESS) return false;
  const runningSince = openLogStartedAt ?? latestLogStartedAt;
  if (!runningSince) return false;
  return now.getTime() - runningSince.getTime() > STALE_IN_PROGRESS_HOURS * 60 * 60 * 1000;
}

export async function autoPauseStaleJobs(now = new Date()) {
  const jobs = await db.job.findMany({
    where: { status: JobStatus.IN_PROGRESS },
    select: {
      id: true,
      jobNumber: true,
      status: true,
      property: { select: { name: true } },
      assignments: {
        where: { removedAt: null },
        select: { userId: true },
      },
      timeLogs: {
        orderBy: { startedAt: "asc" },
        select: { id: true, userId: true, startedAt: true, stoppedAt: true },
      },
    },
  });

  let paused = 0;
  for (const job of jobs) {
    if (paused >= MAX_JOBS_PER_RUN) break;

    const openLogs = job.timeLogs.filter((log) => log.stoppedAt === null);
    const latestLog = job.timeLogs[job.timeLogs.length - 1] ?? null;
    if (
      !qualifiesForAutoPause({
        status: job.status,
        openLogStartedAt: openLogs[0]?.startedAt ?? null,
        latestLogStartedAt: latestLog?.startedAt ?? null,
        now,
      })
    ) {
      continue;
    }

    try {
      // Close every open log the same way the manual stop route does.
      const closedTimeLogIds: string[] = [];
      for (const log of openLogs) {
        const durationM = Math.round((now.getTime() - log.startedAt.getTime()) / 60_000);
        await db.timeLog.update({
          where: { id: log.id },
          data: { stoppedAt: now, durationM },
        });
        closedTimeLogIds.push(log.id);
      }

      // Guard on status so a job that just advanced isn't dragged back.
      await db.job.updateMany({
        where: { id: job.id, status: JobStatus.IN_PROGRESS },
        data: { status: JobStatus.PAUSED },
      });

      // AuditLog needs a real userId (FK) — attribute to the cleaner whose
      // clock we closed (same convention as AUTO_CLOCK_OUT), falling back to
      // the first assignee.
      const auditUserId = openLogs[0]?.userId ?? latestLog?.userId ?? job.assignments[0]?.userId ?? null;
      if (auditUserId) {
        await db.auditLog.create({
          data: {
            userId: auditUserId,
            jobId: job.id,
            action: "JOB_AUTO_PAUSED",
            entity: "Job",
            entityId: job.id,
            after: { reason: "in progress > 24h", closedTimeLogIds } as any,
          },
        });
      }

      // Best-effort notify every assigned cleaner (in-app feed + web push).
      const propertyName = job.property?.name ?? "your job";
      const body = `${job.jobNumber || job.id}: ${propertyName} ran for over 24 hours and was automatically paused. Please open it and submit your checklist, or resume if you're still on site.`;
      for (const assignment of job.assignments) {
        try {
          await db.notification.create({
            data: {
              userId: assignment.userId,
              jobId: job.id,
              channel: NotificationChannel.PUSH,
              subject: "Job auto-paused",
              body,
              status: NotificationStatus.SENT,
              sentAt: new Date(),
            },
          });
          await sendWebPushToUser(assignment.userId, {
            title: "Job auto-paused",
            body,
            url: "/cleaner/jobs",
            tag: `job-auto-paused-${job.id}`,
          });
        } catch (err) {
          logger.warn({ err, jobId: job.id, userId: assignment.userId }, "[auto-pause] notify failed");
        }
      }

      paused += 1;
    } catch (err) {
      logger.error({ err, jobId: job.id }, "[auto-pause] failed to pause stale job");
    }
  }

  if (paused > 0) logger.info({ paused }, "[auto-pause] paused stale IN_PROGRESS jobs");
  return { paused };
}
