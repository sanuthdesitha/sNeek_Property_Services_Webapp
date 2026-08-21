import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { assessMissedClockIn, describeMissedClockIn } from "@/lib/jobs/missed-clock-in";

/** Stable subject, used to detect that this cleaner was already told. */
const MISSED_CLOCK_IN_SUBJECT = "Clock not running";

/**
 * Nudge cleaners who are on site with the clock not running.
 *
 * Runs often and says little: it only ever fires for someone whose arrival is
 * already evidenced (a tag tap, a geofence entry, or their first ping) and who
 * has no open TimeLog. The decision itself is in lib/jobs/missed-clock-in so
 * the thresholds are testable without a database.
 *
 * ONE notification per cleaner per job. A sweep that re-nudges every few
 * minutes is a sweep people turn off, and the second reminder for the same
 * thing carries no information the first did not.
 */
export async function runMissedClockInSweep(now = new Date()) {
  const candidates = await db.job.findMany({
    where: {
      status: { in: [JobStatus.ASSIGNED, JobStatus.EN_ROUTE] },
      // Arrival evidence of some kind must already exist — this sweep detects
      // a missing CLOCK, never a missing cleaner.
      OR: [{ arrivedAt: { not: null } }, { nfcScanEvents: { some: { outcome: "ACCEPTED" } } }],
      scheduledDate: {
        gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        lte: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    },
    select: {
      id: true,
      arrivedAt: true,
      property: { select: { name: true } },
      assignments: {
        where: { removedAt: null },
        select: { userId: true },
      },
      timeLogs: { where: { stoppedAt: null }, select: { userId: true } },
      nfcScanEvents: {
        where: { outcome: "ACCEPTED" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { userId: true, createdAt: true },
      },
    },
    take: 200,
  });

  let nudged = 0;

  for (const job of candidates) {
    const running = new Set(job.timeLogs.map((log) => log.userId));

    for (const assignment of job.assignments) {
      if (running.has(assignment.userId)) continue;

      const tap = job.nfcScanEvents.find((scan) => scan.userId === assignment.userId);
      const firstPing = await db.cleanerLocationPing
        .findFirst({
          where: { jobId: job.id, userId: assignment.userId },
          orderBy: { timestamp: "asc" },
          select: { timestamp: true },
        })
        .catch(() => null);

      const verdict = assessMissedClockIn(
        {
          clockRunning: false,
          tagTapAt: tap?.createdAt ?? null,
          arrivedAt: job.arrivedAt,
          firstPingAt: firstPing?.timestamp ?? null,
        },
        now
      );

      const message = describeMissedClockIn(verdict);
      if (!message) continue;

      // Already told them about this job. Checked against the notification
      // itself rather than a flag column, so no schema is needed for what is
      // really a fact about a message we sent.
      const alreadyNudged = await db.notification
        .findFirst({
          where: {
            userId: assignment.userId,
            jobId: job.id,
            subject: MISSED_CLOCK_IN_SUBJECT,
          },
          select: { id: true },
        })
        .catch(() => null);
      if (alreadyNudged) continue;

      await db.notification
        .create({
          data: {
            userId: assignment.userId,
            jobId: job.id,
            channel: "PUSH",
            subject: MISSED_CLOCK_IN_SUBJECT,
            body: `${job.property?.name ?? "Your job"} — ${message}`,
            status: "SENT",
            sentAt: new Date(),
          },
        })
        .catch(() => undefined);

      nudged += 1;
    }
  }

  return { nudged };
}
