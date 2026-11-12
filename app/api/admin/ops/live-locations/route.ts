import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sydneyDayEndInclusive, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { deriveLiveStatus, LIVE_STALE_AFTER_MS } from "@/lib/ops/live-status";
import { TRACKED_STATUSES } from "@/lib/gps/tracked-statuses";
import { insideFromVerdict, judgeFix } from "@/lib/gps/geofence-policy";
import { trackingStateLabel } from "@/lib/gps/staleness";
import { liveErrorStatus, requireLiveViewer } from "@/lib/ops/live-viewer";

export const dynamic = "force-dynamic";

type ActiveJobInfo = {
  id: string;
  jobNumber: string | null;
  status: string;
  propertyName: string;
  etaMinutes: number | null;
  property: { latitude: number | null; longitude: number | null; geofenceRadiusM: number | null };
  departedAt: Date | null;
};

const PROPERTY_SELECT = { name: true, suburb: true, latitude: true, longitude: true, geofenceRadiusM: true } as const;

/**
 * Snapshot of every cleaner with live work TODAY (Sydney): an open clock
 * started today or on a job scheduled today, or an EN_ROUTE / IN_PROGRESS /
 * PAUSED job scheduled today. A bare ping is not live work.
 *
 * Positions come from UserLastLocation (written on ingest, moved only
 * forward), not from scanning the ping table: the old latest-ping-per-user
 * query used Prisma `distinct`, which is evaluated in memory over every
 * retained ping of those users on every 15-second poll per viewer.
 *
 * Status is judged with the one geofence policy (property radius, accuracy,
 * hysteresis); an inaccurate fix is "location approximate", never "off site".
 * When the phone reported why it stopped (background, permission off,
 * offline), the label says so.
 */
export async function GET() {
  try {
    await requireLiveViewer();
  } catch (err) {
    const status = liveErrorStatus(err);
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }

  const now = Date.now();
  const todayKey = sydneyTodayKey();
  const todayStart = sydneyDayStart(todayKey);
  const todayEnd = sydneyDayEndInclusive(todayKey);

  const [runningLogs, activeJobs] = await Promise.all([
    db.timeLog.findMany({
      where: {
        stoppedAt: null,
        OR: [
          { startedAt: { gte: todayStart } },
          { job: { scheduledDate: { gte: todayStart, lte: todayEnd } } },
        ],
      },
      orderBy: { startedAt: "desc" },
      select: {
        userId: true,
        startedAt: true,
        job: {
          select: {
            id: true, jobNumber: true, status: true, departedAt: true, enRouteEtaMinutes: true,
            property: { select: PROPERTY_SELECT },
          },
        },
      },
    }),
    db.job.findMany({
      where: {
        status: { in: TRACKED_STATUSES },
        assignments: { some: { removedAt: null } },
        scheduledDate: { gte: todayStart, lte: todayEnd },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, jobNumber: true, status: true, arrivedAt: true, departedAt: true, enRouteEtaMinutes: true,
        property: { select: PROPERTY_SELECT },
        assignments: { where: { removedAt: null }, select: { userId: true } },
      },
    }),
  ]);

  const activeUserIds = new Set<string>();
  runningLogs.forEach((log) => activeUserIds.add(log.userId));
  activeJobs.forEach((job) => job.assignments.forEach((a) => activeUserIds.add(a.userId)));
  const userIds = Array.from(activeUserIds);
  if (userIds.length === 0) return NextResponse.json({ pings: [] });

  const [locations, users] = await Promise.all([
    db.userLastLocation.findMany({ where: { userId: { in: userIds } } }),
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const locationByUser = new Map(locations.map((row) => [row.userId, row]));

  const timerByUser = new Map<string, { startedAt: Date; job: (typeof runningLogs)[number]["job"] }>();
  for (const log of runningLogs) {
    if (!timerByUser.has(log.userId)) timerByUser.set(log.userId, { startedAt: log.startedAt, job: log.job });
  }

  const label = (property: { name: string; suburb: string | null }) => (property.suburb ? `${property.name} (${property.suburb})` : property.name);
  const activeJobByUser = new Map<string, ActiveJobInfo>();
  for (const job of activeJobs) {
    for (const assignment of job.assignments) {
      if (activeJobByUser.has(assignment.userId)) continue;
      activeJobByUser.set(assignment.userId, {
        id: job.id, jobNumber: job.jobNumber, status: job.status, propertyName: label(job.property),
        etaMinutes: job.enRouteEtaMinutes, property: job.property, departedAt: job.departedAt ?? null,
      });
    }
  }

  const enriched = userIds.map((userId) => {
    const location = locationByUser.get(userId) ?? null;
    const timer = timerByUser.get(userId) ?? null;
    const timerJob = timer?.job ?? null;
    const activeJob: ActiveJobInfo | null = timerJob
      ? {
          id: timerJob.id, jobNumber: timerJob.jobNumber, status: timerJob.status, propertyName: label(timerJob.property),
          etaMinutes: null, property: timerJob.property, departedAt: timerJob.departedAt ?? null,
        }
      : activeJobByUser.get(userId) ?? null;

    const fix = location?.lat != null && location.lng != null && location.measuredAt
      ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy ?? null, measuredAt: location.measuredAt }
      : null;
    const hasGeofence = activeJob?.property.latitude != null && activeJob?.property.longitude != null;
    const judgement = judgeFix(fix, activeJob?.property);
    const { status: liveStatus, label: liveLabel } = deriveLiveStatus({
      hasOpenTimer: Boolean(timer),
      jobStatus: activeJob?.status ?? null,
      lastPingAt: fix?.measuredAt ?? null,
      insideGeofence: insideFromVerdict(judgement.verdict),
      departedAt: activeJob?.departedAt ?? null,
      now: new Date(now),
      hasGeofence,
      trackingState: location?.trackingState ?? null,
    });

    let lat: number | null = null;
    let lng: number | null = null;
    let positionSource: "gps" | "property" | "none" = "none";
    if (fix) {
      lat = fix.lat;
      lng = fix.lng;
      positionSource = "gps";
    } else if (hasGeofence) {
      lat = activeJob!.property.latitude;
      lng = activeJob!.property.longitude;
      positionSource = "property";
    }

    const pingAgeMs = fix ? now - fix.measuredAt.getTime() : null;
    return {
      userId,
      user: { id: userId, name: nameById.get(userId) ?? null },
      lat,
      lng,
      accuracy: fix?.accuracy ?? null,
      timestamp: fix?.measuredAt.toISOString() ?? null,
      lastPingAt: fix?.measuredAt.toISOString() ?? null,
      positionSource,
      liveStatus,
      liveLabel,
      trackingState: location?.trackingState ?? null,
      trackingStateLabel: trackingStateLabel(location?.trackingState),
      trackingStateAt: location?.trackingStateAt?.toISOString() ?? null,
      distanceM: judgement.distanceM != null ? Math.round(judgement.distanceM) : null,
      geofenceRadiusM: judgement.radiusM,
      activeJob: activeJob
        ? {
            id: activeJob.id, jobNumber: activeJob.jobNumber, status: activeJob.status, propertyName: activeJob.propertyName,
            etaMinutes: activeJob.etaMinutes, departedAt: activeJob.departedAt ? activeJob.departedAt.toISOString() : null,
            propertyLat: activeJob.property.latitude, propertyLng: activeJob.property.longitude,
          }
        : null,
      pingAgeMinutes: pingAgeMs != null ? Math.max(0, Math.round(pingAgeMs / 60_000)) : null,
      stale: pingAgeMs == null || pingAgeMs > LIVE_STALE_AFTER_MS,
      timer: timer
        ? { startedAt: timer.startedAt, elapsedMinutes: Math.max(0, Math.round((now - timer.startedAt.getTime()) / 60_000)) }
        : null,
    };
  });

  enriched.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    return (a.user.name ?? "").localeCompare(b.user.name ?? "");
  });

  return NextResponse.json({ pings: enriched });
}
