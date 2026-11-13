import "server-only";
/**
 * Location ingest for every route that receives fixes:
 *   POST /api/cleaner/location/ping          (the cleaner tracker's batches)
 *   POST /api/cleaner/jobs/[id]/location-ping (driving mode / classic page)
 *   POST /api/laundry/location/ping           (the driver tracker's batches)
 *
 * Order of checks: impersonation (never recorded) → tracking window
 * (lib/gps/tracking-window) → clock-skew correction and backlog rules
 * (lib/gps/ingest) → idempotent store (client ids) → latest position per
 * person (UserLastLocation, only ever moved forward) → arrival / departure
 * from the newest LIVE fix only. Every refused fix is counted under a reason.
 */
import { LocationPingSource, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { isArrivedAtStop, nextIncompleteStop, parseRouteStops, ROUTE_ARRIVAL_RADIUS_M, type RouteStopKind } from "@/lib/laundry/route-plan";
import { checkGeofenceForPing, type GeofenceCheckResult } from "./geofence";
import { handleGeofenceDeparture } from "./departure-clockout";
import {
  addDrop,
  correctFixes,
  isLiveFix,
  mergeDrops,
  parseLocationBatch,
  totalDropped,
  type CorrectedFix,
  type DropCounts,
  type ParsedBatch,
} from "./ingest";
import {
  TRACKING_REFUSAL_TEXT,
  resolveActiveCleanerWindow,
  resolveCleanerJobWindow,
  resolveDriverWindow,
  type TrackingRefusal,
} from "./tracking-window";
import type { TrackingState } from "./staleness";

export type IngestWindow = { active: boolean; reason?: TrackingRefusal; message?: string };

export type IngestResponse = {
  ok: true;
  received: number;
  dropped: number;
  dropReasons: DropCounts;
  window: IngestWindow;
  geofence?: GeofenceCheckResult;
  arrivedStop?: { taskId: string; kind: RouteStopKind };
};

export type IngestOutcome =
  | { status: 200; body: IngestResponse }
  | { status: 400; body: { error: string } }
  | { status: 429; body: { error: string; retryAfterMs: number } };

// ── Rate limit: a small token bucket per person and endpoint ─────────────
// Four requests in a burst (a backlog flush in chunks, a hide/pagehide flush),
// refilling one every ten seconds. Per process, like the old fixed window.
const BUCKET_SIZE = 4;
const REFILL_MS = 10_000;
const globalRef = globalThis as unknown as { __sneekLocationBuckets?: Map<string, { tokens: number; at: number }> };
if (!globalRef.__sneekLocationBuckets) globalRef.__sneekLocationBuckets = new Map();
const buckets = globalRef.__sneekLocationBuckets;

export function takeLocationToken(key: string, now: number): { ok: true } | { ok: false; retryAfterMs: number } {
  const bucket = buckets.get(key) ?? { tokens: BUCKET_SIZE, at: now };
  const refilled = Math.min(BUCKET_SIZE, bucket.tokens + Math.floor((now - bucket.at) / REFILL_MS));
  const at = refilled > bucket.tokens ? now : bucket.at;
  if (refilled < 1) {
    buckets.set(key, { tokens: refilled, at });
    return { ok: false, retryAfterMs: REFILL_MS - (now - at) };
  }
  buckets.set(key, { tokens: refilled - 1, at });
  if (buckets.size > 5000) {
    buckets.forEach((value, k) => { if (now - value.at > 10 * 60_000) buckets.delete(k); });
  }
  return { ok: true };
}

/** Run a side effect that must never fail the request (the fixes are stored). */
async function bestEffort(task: () => unknown): Promise<void> {
  try {
    await task();
  } catch {
    // Swallowed by design.
  }
}

function windowOf(decision: { ok: true } | { ok: false; reason: TrackingRefusal }): IngestWindow {
  return decision.ok ? { active: true } : { active: false, reason: decision.reason, message: TRACKING_REFUSAL_TEXT[decision.reason] };
}

type LastLocationFix = { lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null; measuredAt: Date };

/**
 * Move a person's latest position forward (never backward: a late backlog
 * cannot overwrite a newer fix) and/or record what their phone reported.
 */
export async function writeLastLocation(input: {
  userId: string;
  fix: LastLocationFix | null;
  receivedAt: Date;
  source: LocationPingSource;
  jobId: string | null;
  laundryRouteId: string | null;
  state: { state: TrackingState; at: Date } | null;
}): Promise<void> {
  const stateData = input.state ? { trackingState: input.state.state, trackingStateAt: input.state.at } : {};
  if (input.fix) {
    const data = {
      lat: input.fix.lat,
      lng: input.fix.lng,
      accuracy: input.fix.accuracy,
      heading: input.fix.heading,
      speed: input.fix.speed,
      measuredAt: input.fix.measuredAt,
      receivedAt: input.receivedAt,
      source: input.source,
      jobId: input.jobId,
      laundryRouteId: input.laundryRouteId,
      ...stateData,
    };
    const moved = await db.userLastLocation.updateMany({
      where: { userId: input.userId, OR: [{ measuredAt: null }, { measuredAt: { lt: input.fix.measuredAt } }] },
      data,
    });
    if (moved.count > 0) return;
    try {
      await db.userLastLocation.create({ data: { userId: input.userId, ...data } });
      return;
    } catch (error) {
      // A row with a newer fix already exists: keep its position.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  if (input.state) {
    await db.userLastLocation.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, ...stateData },
      update: stateData,
    });
  }
}

async function storeFixes(rows: Prisma.CleanerLocationPingCreateManyInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const created = await db.cleanerLocationPing.createMany({ data: rows, skipDuplicates: true });
  return created.count;
}

function newestLive(fixes: CorrectedFix[], receivedAt: Date): CorrectedFix | null {
  const newest = fixes[fixes.length - 1];
  return newest && isLiveFix(newest.measuredAt, receivedAt) ? newest : null;
}

function stateFor(batch: ParsedBatch, receivedAt: Date, liveFix: boolean): { state: TrackingState; at: Date } | null {
  if (batch.state) return { state: batch.state.state, at: batch.state.at && batch.state.at <= receivedAt ? batch.state.at : receivedAt };
  return liveFix ? { state: "SHARING", at: receivedAt } : null;
}

function tooMany(retryAfterMs: number): IngestOutcome {
  return { status: 429, body: { error: "Rate limited", retryAfterMs } };
}

/** Cleaner fixes. `jobIdFromUrl` binds every fix to that job (the per-job route). */
export async function ingestCleanerBatch(input: {
  userId: string;
  impersonating: boolean;
  body: unknown;
  jobIdFromUrl?: string;
  now?: Date;
}): Promise<IngestOutcome> {
  const receivedAt = input.now ?? new Date();
  const token = takeLocationToken(`cleaner:${input.userId}`, receivedAt.getTime());
  if (!token.ok) return tooMany(token.retryAfterMs);
  const parsed = parseLocationBatch(input.body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const batch = parsed.batch;
  const dropped: DropCounts = {};

  if (input.impersonating) {
    addDrop(dropped, "IMPERSONATING", batch.fixes.length);
    return { status: 200, body: { ok: true, received: 0, dropped: totalDropped(dropped), dropReasons: dropped, window: windowOf({ ok: false, reason: "IMPERSONATING" }) } };
  }

  const byJob = new Map<string, typeof batch.fixes>();
  for (const fix of batch.fixes) {
    const jobId = input.jobIdFromUrl ?? fix.jobId;
    if (!jobId) {
      addDrop(dropped, "INVALID");
      continue;
    }
    byJob.set(jobId, [...(byJob.get(jobId) ?? []), fix]);
  }

  const notBefore = sydneyDayStart(sydneyTodayKey(receivedAt));
  let received = 0;
  let anyActive: IngestWindow | null = null;
  let lastRefusal: IngestWindow | null = null;
  let newestOverall: { fix: CorrectedFix; jobId: string; source: LocationPingSource } | null = null;
  const liveByJob: Array<{ jobId: string; fix: CorrectedFix }> = [];

  for (const [jobId, fixes] of Array.from(byJob.entries())) {
    const decision = await resolveCleanerJobWindow({ userId: input.userId, jobId, impersonating: false, now: receivedAt });
    if (!decision.ok) {
      addDrop(dropped, decision.reason === "NOT_ASSIGNED" ? "NOT_ASSIGNED" : "OUTSIDE_WINDOW", fixes.length);
      lastRefusal = windowOf(decision);
      continue;
    }
    anyActive = { active: true };
    const corrected = correctFixes(fixes, { sentAt: batch.sentAt, receivedAt, notBefore });
    mergeDrops(dropped, corrected.dropped);
    const stored = await storeFixes(corrected.accepted.map((fix) => ({
      jobId,
      userId: input.userId,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy ?? null,
      heading: fix.heading ?? null,
      speed: fix.speed ?? null,
      timestamp: fix.measuredAt,
      receivedAt,
      source: decision.source,
      clientId: fix.clientId ?? null,
    })));
    addDrop(dropped, "DUPLICATE", corrected.accepted.length - stored);
    received += stored;
    const newest = corrected.accepted[corrected.accepted.length - 1];
    if (newest && (!newestOverall || newest.measuredAt > newestOverall.fix.measuredAt)) {
      newestOverall = { fix: newest, jobId, source: decision.source };
    }
    const live = newestLive(corrected.accepted, receivedAt);
    if (live) liveByJob.push({ jobId, fix: live });
  }

  let window: IngestWindow = anyActive ?? lastRefusal ?? { active: false };
  if (!anyActive && byJob.size === 0) {
    window = windowOf(await resolveActiveCleanerWindow({ userId: input.userId, impersonating: false, now: receivedAt }));
  }

  const hasLive = liveByJob.length > 0;
  if (window.active && (newestOverall || batch.state)) {
    await bestEffort(() => writeLastLocation({
      userId: input.userId,
      fix: newestOverall ? {
        lat: newestOverall.fix.lat, lng: newestOverall.fix.lng, accuracy: newestOverall.fix.accuracy ?? null,
        heading: newestOverall.fix.heading ?? null, speed: newestOverall.fix.speed ?? null, measuredAt: newestOverall.fix.measuredAt,
      } : null,
      receivedAt,
      source: newestOverall?.source ?? LocationPingSource.CLEANER_JOB,
      jobId: newestOverall?.jobId ?? null,
      laundryRouteId: null,
      state: stateFor(batch, receivedAt, hasLive),
    }));
  }

  // Arrival / departure: newest LIVE fix per job only. Best-effort: the
  // fixes are stored, which is this request's job.
  let geofence: GeofenceCheckResult = {};
  for (const { jobId, fix } of liveByJob) {
    try {
      const result = await checkGeofenceForPing({ userId: input.userId, jobId, lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null, pingAt: fix.measuredAt });
      geofence = { ...geofence, ...result };
      if (result.departed) {
        const departed = result.departed;
        await bestEffort(() => handleGeofenceDeparture({ jobId: departed.jobId, userId: input.userId, distanceM: departed.distanceM, now: receivedAt }));
      }
    } catch {
      // Swallow: never fail a ping on the geofence.
    }
  }

  if (received > 0) await bestEffort(() => db.user.update({ where: { id: input.userId }, data: { lastSeenAt: receivedAt } }));

  return {
    status: 200,
    body: { ok: true, received, dropped: totalDropped(dropped), dropReasons: dropped, window, geofence },
  };
}

/**
 * Stamp the next stop's arrival when the driver is within the arrival radius
 * on a precise fix. Optimistic on the route's updatedAt so a stop completed at
 * the same moment is not overwritten by this read-modify-write.
 */
async function detectRouteArrival(routeId: string, fix: CorrectedFix): Promise<{ taskId: string; kind: RouteStopKind } | null> {
  if (fix.accuracy != null && fix.accuracy > ROUTE_ARRIVAL_RADIUS_M) return null;
  const route = await db.laundryRoute.findUnique({ where: { id: routeId }, select: { id: true, stops: true, updatedAt: true, status: true } });
  if (!route || route.status !== "ACTIVE") return null;
  const stops = parseRouteStops(route.stops);
  const next = nextIncompleteStop(stops);
  if (!next || next.arrivedAt) return null;
  const property = await db.property.findUnique({ where: { id: next.propertyId }, select: { latitude: true, longitude: true } });
  if (typeof property?.latitude !== "number" || typeof property?.longitude !== "number") return null;
  if (!isArrivedAtStop(fix.lat, fix.lng, property.latitude, property.longitude)) return null;
  const stamped = stops.map((stop) =>
    stop.taskId === next.taskId && stop.kind === next.kind ? { ...stop, arrivedAt: stop.arrivedAt ?? fix.measuredAt.toISOString() } : stop,
  );
  const written = await db.laundryRoute.updateMany({
    where: { id: route.id, updatedAt: route.updatedAt },
    data: { stops: stamped as unknown as Prisma.InputJsonValue },
  });
  return written.count === 1 ? { taskId: next.taskId, kind: next.kind } : null;
}

/** Driver fixes: only while the driver has an ACTIVE route today. */
export async function ingestDriverBatch(input: {
  userId: string;
  role: string;
  impersonating: boolean;
  body: unknown;
  now?: Date;
}): Promise<IngestOutcome> {
  const receivedAt = input.now ?? new Date();
  const token = takeLocationToken(`laundry:${input.userId}`, receivedAt.getTime());
  if (!token.ok) return tooMany(token.retryAfterMs);
  const parsed = parseLocationBatch(input.body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const batch = parsed.batch;
  const dropped: DropCounts = {};

  const decision = await resolveDriverWindow({ userId: input.userId, role: input.role, impersonating: input.impersonating, now: receivedAt });
  if (!decision.ok) {
    addDrop(dropped, decision.reason === "IMPERSONATING" ? "IMPERSONATING" : "OUTSIDE_WINDOW", batch.fixes.length);
    return { status: 200, body: { ok: true, received: 0, dropped: totalDropped(dropped), dropReasons: dropped, window: windowOf(decision) } };
  }
  const route = decision.route;
  const corrected = correctFixes(batch.fixes, { sentAt: batch.sentAt, receivedAt, notBefore: sydneyDayStart(sydneyTodayKey(receivedAt)) });
  mergeDrops(dropped, corrected.dropped);
  const stored = await storeFixes(corrected.accepted.map((fix) => ({
    jobId: route.anchorJobId,
    userId: input.userId,
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy ?? null,
    heading: fix.heading ?? null,
    speed: fix.speed ?? null,
    timestamp: fix.measuredAt,
    receivedAt,
    source: LocationPingSource.LAUNDRY_ROUTE,
    clientId: fix.clientId ?? null,
    laundryRouteId: route.id,
  })));
  addDrop(dropped, "DUPLICATE", corrected.accepted.length - stored);

  const newest = corrected.accepted[corrected.accepted.length - 1] ?? null;
  const live = newestLive(corrected.accepted, receivedAt);
  if (newest || batch.state) {
    await bestEffort(() => writeLastLocation({
      userId: input.userId,
      fix: newest ? { lat: newest.lat, lng: newest.lng, accuracy: newest.accuracy ?? null, heading: newest.heading ?? null, speed: newest.speed ?? null, measuredAt: newest.measuredAt } : null,
      receivedAt,
      source: LocationPingSource.LAUNDRY_ROUTE,
      jobId: route.anchorJobId,
      laundryRouteId: route.id,
      state: stateFor(batch, receivedAt, Boolean(live)),
    }));
  }
  if (stored > 0) await bestEffort(() => db.user.update({ where: { id: input.userId }, data: { lastSeenAt: receivedAt } }));

  let arrivedStop: { taskId: string; kind: RouteStopKind } | null = null;
  if (live) {
    try {
      arrivedStop = await detectRouteArrival(route.id, live);
    } catch {
      arrivedStop = null;
    }
  }
  return {
    status: 200,
    body: {
      ok: true,
      received: stored,
      dropped: totalDropped(dropped),
      dropReasons: dropped,
      window: { active: true },
      ...(arrivedStop ? { arrivedStop } : {}),
    },
  };
}
