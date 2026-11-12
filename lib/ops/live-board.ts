/**
 * Live ops board loader: today's jobs (Sydney calendar day, drafts excluded)
 * classified by ./live-board-rules, pending continuation requests, active
 * laundry driver routes, and each on-shift cleaner's next job. All counts are
 * computed from the full day, never from a capped list.
 */
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { listContinuationRequests } from "@/lib/jobs/continuation-requests";
import { computeChecklistProgressPercent } from "@/lib/jobs/progress";
import { parseRouteStops } from "@/lib/laundry/route-plan";
import { getAppSettings } from "@/lib/settings";
import { haversine, DEFAULT_GEOFENCE_RADIUS_M } from "@/lib/gps/distance";
import { deriveLiveStatus } from "./live-status";
import { addDaysToKey, sydneyDayEndInclusive, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { classifyLiveJob, clockLabel, isException, isNotStarted } from "./live-board-rules";
import { latestClientDelayRequests, type ClientDelayRequestRecord } from "@/lib/notifications/client-delay-preview";
import type { LiveBoardPayload, LiveCleanerNext, LiveContinuationRow, LiveDriverRow, LiveJobRow, LiveProgress } from "./live-board-types";

type TodayJob = Awaited<ReturnType<typeof loadTodayJobs>>[number];
type Ping = { userId: string; lat: number; lng: number; timestamp: Date };

async function loadTodayJobs(todayKey: string) {
  const jobs = await db.job.findMany({
    // Cancelled jobs are not live work (Wave E).
    where: { scheduledDate: { gte: new Date(`${todayKey}T00:00:00.000Z`), lt: new Date(`${addDaysToKey(todayKey, 1)}T00:00:00.000Z`) }, status: { not: JobStatus.CANCELLED } },
    orderBy: [{ startTime: "asc" }],
    select: {
      id: true, jobNumber: true, jobType: true, propertyId: true, formTemplateId: true, status: true, startTime: true, dueTime: true,
      estimatedHours: true, sameDayCheckinTime: true, arrivedAt: true, departedAt: true, enRouteEtaMinutes: true,
      enRouteEtaUpdatedAt: true, internalNotes: true, cleanSkipStatus: true,
      requiresSafetyCheckin: true, safetyCheckinAt: true, gpsDistanceMeters: true, gpsCheckInAt: true,
      property: { select: { name: true, suburb: true, address: true, latitude: true, longitude: true } },
      assignments: { where: { removedAt: null }, select: { user: { select: { id: true, name: true, email: true, phone: true } } } },
      timeLogs: { where: { stoppedAt: null }, select: { id: true, userId: true, startedAt: true } },
    },
  });
  return jobs.filter((job) => !parseJobInternalNotes(job.internalNotes).isDraft && job.cleanSkipStatus !== "SKIPPED");
}

function liveStatusFor(job: TodayJob, ping: Ping | null, now: Date): { status: string; distance: number | null } {
  const lat = job.property.latitude;
  const lng = job.property.longitude;
  const hasGeofence = lat != null && lng != null;
  const distance = ping && hasGeofence ? haversine(ping.lat, ping.lng, lat as number, lng as number) : null;
  const result = deriveLiveStatus({
    hasOpenTimer: job.timeLogs.length > 0,
    jobStatus: job.status,
    lastPingAt: ping?.timestamp ?? null,
    insideGeofence: distance == null ? null : distance <= DEFAULT_GEOFENCE_RADIUS_M,
    departedAt: job.departedAt,
    now,
    hasGeofence,
  });
  return { status: result.status, distance };
}

async function progressFor(job: TodayJob, elapsed: number | null, allocated: number | null, settings: Awaited<ReturnType<typeof getAppSettings>> | null): Promise<LiveProgress | null> {
  if (settings && job.status === JobStatus.IN_PROGRESS) {
    const checklist = await computeChecklistProgressPercent(job, settings);
    if (checklist != null) return { percent: checklist, basis: "checklist" };
  }
  if (elapsed != null && allocated) return { percent: Math.min(100, Math.round((elapsed / allocated) * 100)), basis: "time" };
  return null;
}

/** Today's client delay notices for the late jobs; a failed read shows none rather than failing the board. */
async function delayNoticesFor(jobIds: string[], now: Date): Promise<Map<string, ClientDelayRequestRecord>> {
  if (jobIds.length === 0) return new Map();
  return latestClientDelayRequests(jobIds, now).catch(() => new Map());
}

async function buildJobRows(jobs: TodayJob[], pings: Map<string, Ping>, now: Date, timeZone: string, todayKey: string, withProgress: boolean): Promise<LiveJobRow[]> {
  const settings = withProgress ? await getAppSettings().catch(() => null) : null;
  const cleanerNames = new Map(jobs.flatMap((job) => job.assignments.map((a) => [a.user.id, a.user.name ?? a.user.email] as const)));
  const rows = await Promise.all(jobs.map((job) => buildJobRow(job, pings, now, timeZone, todayKey, withProgress, settings, cleanerNames)));
  const notices = await delayNoticesFor(rows.filter((row) => row.state === "late").map((row) => row.jobId), now);
  return rows.map((row) => (row.state === "late" ? { ...row, delayNotice: notices.get(row.jobId) ?? null } : row));
}

async function buildJobRow(
  job: TodayJob,
  pings: Map<string, Ping>,
  now: Date,
  timeZone: string,
  todayKey: string,
  withProgress: boolean,
  settings: Awaited<ReturnType<typeof getAppSettings>> | null,
  cleanerNames: Map<string, string>,
): Promise<LiveJobRow> {
  const cleaners = job.assignments.map((a) => ({ id: a.user.id, name: a.user.name ?? a.user.email, phone: a.user.phone ?? null }));
  const ping = cleaners.map((c) => pings.get(c.id)).find(Boolean) ?? null;
  const live = liveStatusFor(job, ping, now);
  const timer = job.timeLogs[0] ?? null;
  const classification = classifyLiveJob({
    status: job.status, dateKey: todayKey, startTime: job.startTime, arrivedAt: job.arrivedAt, departedAt: job.departedAt,
    enRouteEtaMinutes: job.enRouteEtaMinutes, enRouteEtaUpdatedAt: job.enRouteEtaUpdatedAt, hasOpenTimer: Boolean(timer), liveStatus: live.status,
  }, now, timeZone);
  const startedAt = job.arrivedAt ?? timer?.startedAt ?? null;
  const elapsed = classification.state === "on-site" && startedAt ? Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000)) : null;
  const allocated = job.estimatedHours ? Math.round(job.estimatedHours * 60) : null;
  return {
    jobId: job.id, jobNumber: job.jobNumber, propertyName: job.property.name, suburb: job.property.suburb, status: job.status,
    state: classification.state, startTime: job.startTime, dueTime: job.dueTime, sameDayCheckinTime: job.sameDayCheckinTime, cleaners,
    minutes: classification.minutes,
    etaClock: classification.projectedArrival ? clockLabel(classification.projectedArrival, timeZone) : null,
    distanceMeters: classification.state === "off-site" && live.distance != null ? Math.round(live.distance) : null,
    elapsedMinutes: elapsed, allocatedMinutes: allocated,
    progress: withProgress && classification.state === "on-site" ? await progressFor(job, elapsed, allocated, settings) : null,
    openTimeLogId: timer?.id ?? null,
    etaAt: classification.state === "late" && classification.projectedArrival ? classification.projectedArrival.toISOString() : null,
    runningClocks: job.timeLogs.map((log) => ({ timeLogId: log.id, userId: log.userId, name: cleanerNames.get(log.userId) ?? "Cleaner", startedAt: log.startedAt.toISOString() })),
    field: {
      address: job.property.address ?? null,
      safety: job.safetyCheckinAt ? "confirmed" : job.requiresSafetyCheckin ? "pending" : null,
      checkInDistanceMeters: job.gpsDistanceMeters ?? null,
      gpsCheckInAt: job.gpsCheckInAt?.toISOString() ?? null,
    },
  };
}

async function loadContinuations(): Promise<LiveContinuationRow[]> {
  const requests = await listContinuationRequests({ status: "PENDING" });
  if (requests.length === 0) return [];
  const [jobs, users] = await Promise.all([
    db.job.findMany({ where: { id: { in: requests.map((r) => r.jobId) } }, select: { id: true, property: { select: { name: true } } } }),
    db.user.findMany({ where: { id: { in: requests.map((r) => r.requestedByUserId) } }, select: { id: true, name: true } }),
  ]);
  const jobById = new Map(jobs.map((j) => [j.id, j.property.name]));
  const nameById = new Map(users.map((u) => [u.id, u.name ?? "Cleaner"]));
  return requests.map((r) => ({
    id: r.id, jobId: r.jobId, propertyName: jobById.get(r.jobId) ?? "Job", cleanerName: nameById.get(r.requestedByUserId) ?? "Cleaner",
    reason: r.reason, remainingHours: r.estimatedRemainingHours, requestedAt: r.requestedAt,
  }));
}

async function loadDrivers(todayKey: string): Promise<LiveDriverRow[]> {
  const routes = await db.laundryRoute.findMany({
    where: { status: "ACTIVE", date: { gte: sydneyDayStart(todayKey), lte: sydneyDayEndInclusive(todayKey) } },
    select: { id: true, userId: true, stops: true, user: { select: { name: true, email: true, phone: true } } },
  });
  if (routes.length === 0) return [];
  const pings = await db.cleanerLocationPing.findMany({
    where: { userId: { in: routes.map((r) => r.userId) } }, orderBy: { timestamp: "desc" }, distinct: ["userId"],
    select: { userId: true, lat: true, lng: true, timestamp: true },
  });
  const pingBy = new Map(pings.map((p) => [p.userId, p]));
  return routes.map((route) => {
    const stops = parseRouteStops(route.stops);
    const ping = pingBy.get(route.userId);
    return {
      routeId: route.id, userId: route.userId, name: route.user.name ?? route.user.email, phone: route.user.phone ?? null,
      stopsDone: stops.filter((s) => s.completedAt).length, stopsTotal: stops.length,
      lat: ping?.lat ?? null, lng: ping?.lng ?? null, lastPingAt: ping?.timestamp.toISOString() ?? null,
    };
  });
}

function nextJobs(rows: LiveJobRow[]): LiveCleanerNext[] {
  const byCleaner = new Map<string, LiveCleanerNext>();
  for (const row of rows) {
    for (const cleaner of row.cleaners) {
      const entry = byCleaner.get(cleaner.id) ?? { userId: cleaner.id, nextJob: null, phone: cleaner.phone };
      if (!entry.nextJob && (row.state === "planned" || row.state === "not-started")) {
        entry.nextJob = { jobId: row.jobId, propertyName: row.propertyName, startTime: row.startTime };
      }
      byCleaner.set(cleaner.id, entry);
    }
  }
  return Array.from(byCleaner.values());
}

/** `withProgress: false` skips the per-job checklist reads (Command's header and tiles). */
export async function loadLiveBoard(options: { now?: Date; timeZone?: string; withProgress?: boolean } = {}): Promise<LiveBoardPayload> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "Australia/Sydney";
  const todayKey = sydneyTodayKey(now);
  const jobs = await loadTodayJobs(todayKey);
  const cleanerIds = Array.from(new Set(jobs.flatMap((job) => job.assignments.map((a) => a.user.id))));
  const [pings, continuations, drivers] = await Promise.all([
    cleanerIds.length
      ? db.cleanerLocationPing.findMany({ where: { userId: { in: cleanerIds } }, orderBy: { timestamp: "desc" }, distinct: ["userId"], select: { userId: true, lat: true, lng: true, timestamp: true } })
      : Promise.resolve([] as Ping[]),
    loadContinuations(),
    loadDrivers(todayKey),
  ]);
  const rows = await buildJobRows(jobs, new Map(pings.map((p) => [p.userId, p])), now, timeZone, todayKey, options.withProgress !== false);
  const onShift = new Set(rows.filter((r) => ["on-site", "off-site", "travelling", "late"].includes(r.state)).flatMap((r) => r.cleaners.map((c) => c.id)));
  return {
    todayKey, timeZone, jobs: rows, continuations, drivers, cleaners: nextJobs(rows),
    counts: {
      exceptions: rows.filter((r) => isException(r.state)).length + continuations.length,
      onSite: rows.filter((r) => r.state === "on-site").length,
      travelling: rows.filter((r) => r.state === "travelling").length,
      notStarted: rows.filter((r) => isNotStarted(r.state)).length,
      cleanersOnShift: onShift.size,
      driversOnShift: drivers.length,
    },
    generatedAt: now.toISOString(),
  };
}
