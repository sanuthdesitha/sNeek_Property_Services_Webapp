import { NextRequest, NextResponse } from "next/server";
import { Role, JobStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getEtaMinutes } from "@/lib/jobs/eta";

const STALE_PING_MS = 10 * 60 * 1000;

export async function GET(_req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const since = new Date(Date.now() - STALE_PING_MS);

    const liveJobs = await db.job.findMany({
      where: {
        status: { in: [JobStatus.EN_ROUTE, JobStatus.PAUSED, JobStatus.IN_PROGRESS] },
        cleanerLocationPings: { some: { timestamp: { gte: since } } },
      },
      select: {
        id: true,
        status: true,
        jobNumber: true,
        jobType: true,
        enRouteStartedAt: true,
        enRouteEtaMinutes: true,
        enRouteEtaUpdatedAt: true,
        drivingPausedAt: true,
        drivingPauseReason: true,
        drivingDelayedAt: true,
        drivingDelayedReason: true,
        arrivedAt: true,
        property: {
          select: {
            name: true,
            suburb: true,
            address: true,
            state: true,
            latitude: true,
            longitude: true,
          },
        },
        assignments: {
          where: { removedAt: null, isPrimary: true },
          select: { user: { select: { id: true, name: true } } },
        },
        cleanerLocationPings: {
          orderBy: { timestamp: "desc" },
          take: 1,
          select: { lat: true, lng: true, accuracy: true, heading: true, speed: true, timestamp: true, userId: true },
        },
      },
    });

    // Running timers (stoppedAt: null) for the cleaners on these jobs, so the
    // admin list can show "clocked in HH:mm · elapsed 1h 23m".
    const jobIds = liveJobs.map((job) => job.id);
    const runningLogs = jobIds.length
      ? await db.timeLog.findMany({
          where: { jobId: { in: jobIds }, stoppedAt: null },
          orderBy: { startedAt: "desc" },
          select: { jobId: true, userId: true, startedAt: true },
        })
      : [];
    const runningLogByJob = new Map<string, { userId: string; startedAt: Date }>();
    for (const log of runningLogs) {
      if (!runningLogByJob.has(log.jobId)) {
        runningLogByJob.set(log.jobId, { userId: log.userId, startedAt: log.startedAt });
      }
    }
    const nowMs = Date.now();

    const results = await Promise.all(
      liveJobs.map(async (job) => {
        const ping = job.cleanerLocationPings[0] ?? null;
        const assignment = job.assignments[0];
        const runningLog = runningLogByJob.get(job.id) ?? null;
        const propLat = job.property.latitude;
        const propLng = job.property.longitude;
        const propAddress = [job.property.address, job.property.suburb, job.property.state, "Australia"]
          .filter(Boolean).join(", ");

        let etaMinutes = job.enRouteEtaMinutes;
        if (etaMinutes == null && ping) {
          etaMinutes = await getEtaMinutes({
            fromLat: ping.lat,
            fromLng: ping.lng,
            toLat: propLat,
            toLng: propLng,
            toAddress: propLat == null ? propAddress : null,
          });
        }

        const propertyName = job.property.suburb
          ? `${job.property.name} (${job.property.suburb})`
          : job.property.name;

        return {
          jobId: job.id,
          jobNumber: job.jobNumber,
          jobType: job.jobType,
          cleanerName: assignment?.user?.name ?? "Unknown cleaner",
          cleanerUserId: assignment?.user?.id ?? ping?.userId ?? null,
          lat: ping?.lat ?? null,
          lng: ping?.lng ?? null,
          accuracy: ping?.accuracy ?? null,
          heading: ping?.heading ?? null,
          speed: ping?.speed ?? null,
          lastPingAt: ping?.timestamp ?? null,
          propertyName,
          propertyLat: propLat,
          propertyLng: propLng,
          etaMinutes,
          etaUpdatedAt: job.enRouteEtaUpdatedAt,
          enRouteStartedAt: job.enRouteStartedAt,
          drivingPausedAt: job.drivingPausedAt,
          drivingPauseReason: job.drivingPauseReason,
          drivingDelayedAt: job.drivingDelayedAt,
          drivingDelayedReason: job.drivingDelayedReason,
          arrivedAt: job.arrivedAt,
          jobStatus: job.status,
          clockInAt: runningLog?.startedAt ?? null,
          elapsedMinutes: runningLog
            ? Math.max(0, Math.round((nowMs - runningLog.startedAt.getTime()) / 60_000))
            : null,
        };
      })
    );

    return NextResponse.json(results);
  } catch (err: any) {
    let status = 500;
    if (err.message === "UNAUTHORIZED") status = 401;
    else if (err.message === "FORBIDDEN") status = 403;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
