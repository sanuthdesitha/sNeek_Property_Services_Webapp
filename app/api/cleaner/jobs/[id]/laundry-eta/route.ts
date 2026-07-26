/**
 * GET /api/cleaner/jobs/[id]/laundry-eta — realtime status of the laundry
 * cycle feeding THIS clean (the previous clean's task at the same property),
 * polled by the cleaner workspace's laundry-cycle card.
 *
 * Response states:
 *  - none       — no previous cycle / laundry not applicable to this job
 *  - delivered  — the drop already happened (droppedAt + drop photo proof)
 *  - scheduled  — cycle exists but no ACTIVE driver route includes its drop
 *  - no_signal  — driver has an active route but no fresh ping (≤5 min)
 *  - en_route   — { isNextStop, stopsBefore, etaMinutes, driverLat, driverLng }
 *
 * The driver's identity is NEVER included. A module-level 30s cache keyed by
 * jobId bounds repeated polling across cleaners on the same job.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";
import { getPreviousCleanLaundryCycle } from "@/lib/laundry/previous-cycle";
import { parseRouteStops } from "@/lib/laundry/route-plan";
import { sydneyDayKey } from "@/lib/laundry/route-candidates";
import { estimateChainedEtaMinutes, type LatLng } from "@/lib/laundry/eta-chain";
import { getEtaMinutes } from "@/lib/jobs/eta";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const STALE_PING_MS = 5 * 60_000;

type CachedResponse = { at: number; body: Record<string, unknown> };
const globalRef = globalThis as unknown as {
  __sneekLaundryEtaCache?: Map<string, CachedResponse>;
};
if (!globalRef.__sneekLaundryEtaCache) globalRef.__sneekLaundryEtaCache = new Map();
const responseCache = globalRef.__sneekLaundryEtaCache;

async function computeBody(job: {
  id: string;
  propertyId: string;
  scheduledDate: Date;
  property: { latitude: number | null; longitude: number | null } | null;
}): Promise<Record<string, unknown>> {
  const cycle = await getPreviousCleanLaundryCycle(
    db,
    job.propertyId,
    job.id,
    job.scheduledDate,
  );
  if (!cycle) return { state: "none" };

  if (cycle.status === "DROPPED") {
    return {
      state: "delivered",
      droppedAt: cycle.droppedAt,
      dropPhotoUrl: cycle.dropPhotoUrl ?? null,
      dropPhotoKey: cycle.dropPhotoKey ?? null,
    };
  }

  // An ACTIVE route (today, Sydney) whose stops include this cycle's DROP.
  const activeRoutes = await db.laundryRoute.findMany({
    where: { status: "ACTIVE", date: sydneyDayKey(new Date()) },
    orderBy: { startedAt: "desc" },
  });
  let route: (typeof activeRoutes)[number] | null = null;
  let stops: ReturnType<typeof parseRouteStops> = [];
  for (const candidate of activeRoutes) {
    const parsed = parseRouteStops(candidate.stops);
    if (parsed.some((s) => s.taskId === cycle.taskId && s.kind === "DROP")) {
      route = candidate;
      stops = parsed;
      break;
    }
  }
  if (!route) {
    return {
      state: "scheduled",
      pickupDate: cycle.pickupDate,
      dropoffDate: cycle.dropoffDate,
    };
  }

  const targetStop = stops.find((s) => s.taskId === cycle.taskId && s.kind === "DROP")!;
  if (targetStop.completedAt) {
    // Route says the drop landed even if the task status hasn't flipped yet.
    return {
      state: "delivered",
      droppedAt: cycle.droppedAt ?? targetStop.completedAt,
      dropPhotoUrl: cycle.dropPhotoUrl ?? null,
      dropPhotoKey: cycle.dropPhotoKey ?? null,
    };
  }

  // Latest fresh ping for that driver (identity never leaves the server).
  const ping = await db.cleanerLocationPing.findFirst({
    where: { userId: route.userId },
    orderBy: { timestamp: "desc" },
    select: { lat: true, lng: true, timestamp: true },
  });
  if (!ping || Date.now() - ping.timestamp.getTime() > STALE_PING_MS) {
    return { state: "no_signal", dropoffDate: cycle.dropoffDate };
  }

  // Incomplete stops the driver services before this property's DROP.
  const stopsBeforeTarget = stops.filter(
    (s) => s.order < targetStop.order && !s.completedAt,
  );
  const stopsBefore = stopsBeforeTarget.length;

  // Positions: intermediate stop properties + this job's property.
  const propertyIds = Array.from(new Set(stopsBeforeTarget.map((s) => s.propertyId)));
  const properties = propertyIds.length
    ? await db.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, latitude: true, longitude: true },
      })
    : [];
  const positionByProperty = new Map(
    properties
      .filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number")
      .map((p) => [p.id, { lat: p.latitude as number, lng: p.longitude as number }]),
  );
  const chain: LatLng[] = stopsBeforeTarget
    .map((s) => positionByProperty.get(s.propertyId))
    .filter((p): p is LatLng => Boolean(p));

  const driverPos: LatLng = { lat: ping.lat, lng: ping.lng };
  const target: LatLng | null =
    typeof job.property?.latitude === "number" && typeof job.property?.longitude === "number"
      ? { lat: job.property.latitude, lng: job.property.longitude }
      : null;

  const etaMinutes = target
    ? await estimateChainedEtaMinutes({
        driverPos,
        stops: chain,
        target,
        serviceStopCount: stopsBefore,
        legEtaFn:
          stopsBefore === 0
            ? (from, to) =>
                getEtaMinutes({ fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng })
            : undefined,
      })
    : null;

  return {
    state: "en_route",
    isNextStop: stopsBefore === 0,
    stopsBefore,
    etaMinutes,
    driverLat: ping.lat,
    driverLng: ping.lng,
    dropoffDate: cycle.dropoffDate,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        propertyId: true,
        scheduledDate: true,
        jobType: true,
        isRework: true,
        assignments: { where: { removedAt: null }, select: { userId: true } },
        property: { select: { laundryEnabled: true, latitude: true, longitude: true } },
      },
    });
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (
      session.user.role === Role.CLEANER &&
      !job.assignments.some((assignment) => assignment.userId === session.user.id)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!isLaundryUpdateEligible(job, job.property)) {
      return NextResponse.json({ state: "none" });
    }

    const cached = responseCache.get(job.id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.body);
    }

    const body = await computeBody(job);
    responseCache.set(job.id, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status });
  }
}
