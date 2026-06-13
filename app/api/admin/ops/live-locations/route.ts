import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { JobStatus, Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SNAPSHOT_WINDOW_MS = 15 * 60_000;

/**
 * Snapshot of the latest ping per active cleaner over the last 15 minutes,
 * enriched with each cleaner's current active job (running time log first,
 * then an en-route/in-progress assignment) and live timer details so the ops
 * map can show "clocked in HH:mm · elapsed 1h 23m" on every dot.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN && session?.user?.role !== Role.OPS_MANAGER) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const since = new Date(Date.now() - SNAPSHOT_WINDOW_MS);
  const pings = await db.cleanerLocationPing.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    distinct: ["userId"],
    include: {
      user: { select: { id: true, name: true, lastSeenAt: true } },
    },
  });

  const userIds = Array.from(new Set(pings.map((ping) => ping.userId)));

  const [runningLogs, activeJobs] = userIds.length
    ? await Promise.all([
        // One running (stoppedAt: null) time log per cleaner — the live timer.
        db.timeLog.findMany({
          where: { userId: { in: userIds }, stoppedAt: null },
          orderBy: { startedAt: "desc" },
          select: {
            userId: true,
            startedAt: true,
            job: {
              select: {
                id: true,
                jobNumber: true,
                status: true,
                property: { select: { name: true, suburb: true } },
              },
            },
          },
        }),
        // En-route / in-progress assignments for cleaners without a running log.
        db.job.findMany({
          where: {
            status: { in: [JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.PAUSED] },
            assignments: { some: { userId: { in: userIds }, removedAt: null } },
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            jobNumber: true,
            status: true,
            arrivedAt: true,
            enRouteEtaMinutes: true,
            property: { select: { name: true, suburb: true } },
            assignments: {
              where: { removedAt: null, userId: { in: userIds } },
              select: { userId: true },
            },
          },
        }),
      ])
    : [[], []];

  const now = Date.now();
  const timerByUser = new Map<string, { startedAt: Date; job: (typeof runningLogs)[number]["job"] }>();
  for (const log of runningLogs) {
    if (!timerByUser.has(log.userId)) timerByUser.set(log.userId, { startedAt: log.startedAt, job: log.job });
  }
  const activeJobByUser = new Map<
    string,
    { id: string; jobNumber: string | null; status: string; propertyName: string; etaMinutes: number | null }
  >();
  for (const job of activeJobs) {
    for (const assignment of job.assignments) {
      if (!activeJobByUser.has(assignment.userId)) {
        activeJobByUser.set(assignment.userId, {
          id: job.id,
          jobNumber: job.jobNumber,
          status: job.status,
          propertyName: job.property.suburb ? `${job.property.name} (${job.property.suburb})` : job.property.name,
          etaMinutes: job.enRouteEtaMinutes,
        });
      }
    }
  }

  const enriched = pings.map((ping) => {
    const timer = timerByUser.get(ping.userId) ?? null;
    const timerJob = timer?.job ?? null;
    const fallbackJob = activeJobByUser.get(ping.userId) ?? null;
    const activeJob = timerJob
      ? {
          id: timerJob.id,
          jobNumber: timerJob.jobNumber,
          status: timerJob.status,
          propertyName: timerJob.property.suburb
            ? `${timerJob.property.name} (${timerJob.property.suburb})`
            : timerJob.property.name,
          etaMinutes: null as number | null,
        }
      : fallbackJob;
    const liveStatus = timer
      ? "ON_SITE"
      : activeJob?.status === "EN_ROUTE"
        ? "EN_ROUTE"
        : activeJob
          ? "ON_SITE"
          : "IDLE";
    return {
      ...ping,
      liveStatus,
      activeJob,
      timer: timer
        ? {
            startedAt: timer.startedAt,
            elapsedMinutes: Math.max(0, Math.round((now - timer.startedAt.getTime()) / 60_000)),
          }
        : null,
    };
  });

  return NextResponse.json({ pings: enriched });
}
