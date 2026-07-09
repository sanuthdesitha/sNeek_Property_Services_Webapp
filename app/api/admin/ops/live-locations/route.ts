import { NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const SNAPSHOT_WINDOW_MS = 15 * 60_000;
// A GPS fix older than this is "stale" — the cleaner is still shown (they have
// an active job) but flagged so ops knows the dot is a last-known position, not
// a live one.
const STALE_AFTER_MS = 3 * 60_000;

type ActiveJobInfo = {
  id: string;
  jobNumber: string | null;
  status: string;
  propertyName: string;
  etaMinutes: number | null;
  propertyLat: number | null;
  propertyLng: number | null;
};

/**
 * Snapshot of every cleaner who currently has live work — a running timer
 * (clocked in), an EN_ROUTE / IN_PROGRESS / PAUSED assignment, or a fresh ping —
 * enriched with their active job, ETA, and running timer.
 *
 * Liveness is driven by WORK, not by the ping window: a cleaner with an active
 * job stays on the map at their last known position even if their phone stopped
 * pinging (backgrounded / lost signal), and if they have no ping at all we fall
 * back to the job's property coordinates so the map is never empty while someone
 * is on a job. Each entry carries `stale` / `pingAgeMinutes` / `positionSource`
 * so the UI can clearly distinguish a genuinely live dot from a stale one.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== Role.ADMIN && session?.user?.role !== Role.OPS_MANAGER) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = Date.now();
  const since = new Date(now - SNAPSHOT_WINDOW_MS);

  const [runningLogs, activeJobs, freshPings] = await Promise.all([
    db.timeLog.findMany({
      where: { stoppedAt: null },
      orderBy: { startedAt: "desc" },
      select: {
        userId: true,
        startedAt: true,
        job: {
          select: {
            id: true,
            jobNumber: true,
            status: true,
            enRouteEtaMinutes: true,
            property: { select: { name: true, suburb: true, latitude: true, longitude: true } },
          },
        },
      },
    }),
    db.job.findMany({
      where: {
        status: { in: [JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.PAUSED] },
        assignments: { some: { removedAt: null } },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        jobNumber: true,
        status: true,
        arrivedAt: true,
        enRouteEtaMinutes: true,
        property: { select: { name: true, suburb: true, latitude: true, longitude: true } },
        assignments: { where: { removedAt: null }, select: { userId: true } },
      },
    }),
    db.cleanerLocationPing.findMany({
      where: { timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);

  // Union of everyone we should plot.
  const activeUserIds = new Set<string>();
  runningLogs.forEach((log) => activeUserIds.add(log.userId));
  activeJobs.forEach((job) => job.assignments.forEach((a) => activeUserIds.add(a.userId)));
  freshPings.forEach((p) => activeUserIds.add(p.userId));
  const userIds = Array.from(activeUserIds);

  if (userIds.length === 0) {
    return NextResponse.json({ pings: [] });
  }

  // Latest ping per active cleaner (ANY age) + names for everyone in the union
  // (a cleaner with an active job may have zero pings yet).
  const [pings, users] = await Promise.all([
    db.cleanerLocationPing.findMany({
      where: { userId: { in: userIds } },
      orderBy: { timestamp: "desc" },
      distinct: ["userId"],
      include: { user: { select: { id: true, name: true, lastSeenAt: true } } },
    }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);

  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const pingByUser = new Map(pings.map((p) => [p.userId, p]));

  const timerByUser = new Map<string, { startedAt: Date; job: (typeof runningLogs)[number]["job"] }>();
  for (const log of runningLogs) {
    if (!timerByUser.has(log.userId)) timerByUser.set(log.userId, { startedAt: log.startedAt, job: log.job });
  }

  const activeJobByUser = new Map<string, ActiveJobInfo>();
  for (const job of activeJobs) {
    for (const assignment of job.assignments) {
      if (!activeJobByUser.has(assignment.userId)) {
        activeJobByUser.set(assignment.userId, {
          id: job.id,
          jobNumber: job.jobNumber,
          status: job.status,
          propertyName: job.property.suburb ? `${job.property.name} (${job.property.suburb})` : job.property.name,
          etaMinutes: job.enRouteEtaMinutes,
          propertyLat: job.property.latitude ?? null,
          propertyLng: job.property.longitude ?? null,
        });
      }
    }
  }

  const enriched = userIds.map((userId) => {
    const ping = pingByUser.get(userId) ?? null;
    const timer = timerByUser.get(userId) ?? null;
    const timerJob = timer?.job ?? null;
    const fallbackJob = activeJobByUser.get(userId) ?? null;

    const activeJob: ActiveJobInfo | null = timerJob
      ? {
          id: timerJob.id,
          jobNumber: timerJob.jobNumber,
          status: timerJob.status,
          propertyName: timerJob.property.suburb
            ? `${timerJob.property.name} (${timerJob.property.suburb})`
            : timerJob.property.name,
          etaMinutes: null,
          propertyLat: timerJob.property.latitude ?? null,
          propertyLng: timerJob.property.longitude ?? null,
        }
      : fallbackJob;

    const liveStatus = timer
      ? "ON_SITE"
      : activeJob?.status === "EN_ROUTE"
        ? "EN_ROUTE"
        : activeJob
          ? "ON_SITE"
          : "IDLE";

    // Position: prefer the real GPS ping; otherwise fall back to the active
    // job's property so an on-job cleaner still shows on the map.
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy: number | null = null;
    let timestamp: string | null = null;
    let positionSource: "gps" | "property" | "none" = "none";

    if (ping) {
      lat = ping.lat;
      lng = ping.lng;
      accuracy = ping.accuracy ?? null;
      timestamp = ping.timestamp.toISOString();
      positionSource = "gps";
    } else if (activeJob?.propertyLat != null && activeJob?.propertyLng != null) {
      lat = activeJob.propertyLat;
      lng = activeJob.propertyLng;
      positionSource = "property";
    }

    const pingAgeMs = ping ? now - ping.timestamp.getTime() : null;
    const pingAgeMinutes = pingAgeMs != null ? Math.max(0, Math.round(pingAgeMs / 60_000)) : null;
    const stale = ping == null || (pingAgeMs != null && pingAgeMs > STALE_AFTER_MS);

    return {
      userId,
      user: { id: userId, name: nameById.get(userId) ?? null },
      lat,
      lng,
      accuracy,
      timestamp,
      lastPingAt: timestamp,
      positionSource,
      liveStatus,
      activeJob: activeJob
        ? {
            id: activeJob.id,
            jobNumber: activeJob.jobNumber,
            status: activeJob.status,
            propertyName: activeJob.propertyName,
            etaMinutes: activeJob.etaMinutes,
          }
        : null,
      pingAgeMinutes,
      stale,
      timer: timer
        ? {
            startedAt: timer.startedAt,
            elapsedMinutes: Math.max(0, Math.round((now - timer.startedAt.getTime()) / 60_000)),
          }
        : null,
    };
  });

  // Freshest / most-actionable first: live GPS before stale, then by name.
  enriched.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    return (a.user.name ?? "").localeCompare(b.user.name ?? "");
  });

  return NextResponse.json({ pings: enriched });
}
