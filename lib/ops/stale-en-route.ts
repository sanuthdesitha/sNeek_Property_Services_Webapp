import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * A job goes EN_ROUTE when the cleaner taps "start driving". The only ways out
 * are arrive / stop-driving / start(→IN_PROGRESS). If the cleaner closes the app,
 * loses signal, or the job is handled another way, it can sit EN_ROUTE forever —
 * auto-clockout only watches open TimeLogs (an en-route job has none) and the
 * reservation pruner ignores EN_ROUTE. This sweep reverts abandoned en-route
 * jobs back to ASSIGNED so they don't stay "on the way" indefinitely and the
 * client no longer sees a stale live status.
 */
const STALE_EN_ROUTE_HOURS = 6;

export async function sweepStaleEnRouteJobs(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_EN_ROUTE_HOURS * 60 * 60 * 1000);
  const stale = await db.job.findMany({
    where: {
      status: JobStatus.EN_ROUTE,
      arrivedAt: null,
      enRouteStartedAt: { not: null, lt: cutoff },
    },
    select: { id: true },
  });
  if (stale.length === 0) return { reverted: 0 };

  const ids = stale.map((j) => j.id);
  // Guard on status: EN_ROUTE so a job that just transitioned isn't clobbered.
  const result = await db.job.updateMany({
    where: { id: { in: ids }, status: JobStatus.EN_ROUTE, arrivedAt: null },
    data: {
      status: JobStatus.ASSIGNED,
      enRouteStartedAt: null,
      enRouteEtaMinutes: null,
      enRouteEtaUpdatedAt: null,
    },
  });

  // AuditLog requires a real userId (FK); this is a system sweep, so we record
  // it via the logger rather than a user-attributed audit row.
  logger.info({ reverted: result.count, jobIds: ids }, "Reverted stale EN_ROUTE jobs to ASSIGNED");
  return { reverted: result.count };
}
