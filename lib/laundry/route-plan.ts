/**
 * Pure route-planning math for the laundry route builder / runner / plan brief.
 * No Prisma, no fetch — unit-testable (tests/lib/route-plan.test.ts).
 *
 * Shapes:
 *  - LaundryRoute.stops JSON (persisted, lean):
 *      [{ taskId, kind: "PICKUP"|"DROP", order, propertyId, arrivedAt?, completedAt? }]
 *  - Naive travel model for the plan-brief deadline check: haversine distance at
 *    NAIVE_SPEED_KMH plus NAIVE_PER_STOP_MIN minutes of service per stop — cheap
 *    by design (NO Distance Matrix here).
 */
import { haversine } from "@/lib/gps/distance";

export type RouteStopKind = "PICKUP" | "DROP";

export type RouteStopJson = {
  taskId: string;
  kind: RouteStopKind;
  order: number;
  propertyId: string;
  arrivedAt?: string | null;
  completedAt?: string | null;
};

export const ROUTE_ARRIVAL_RADIUS_M = 120;
export const NAIVE_SPEED_KMH = 35;
export const NAIVE_PER_STOP_MIN = 7;

/** Within the auto-open geofence of a stop's property? */
export function isArrivedAtStop(
  lat: number,
  lng: number,
  stopLat: number,
  stopLng: number,
  radiusM: number = ROUTE_ARRIVAL_RADIUS_M,
): boolean {
  return haversine(lat, lng, stopLat, stopLng) <= radiusM;
}

/**
 * Default candidate/stop ordering: scheduled time first, then suburb — the
 * same comparator the live route map has always used for today's stops.
 */
export function compareByTimeThenSuburb(
  a: { scheduledAt: string | Date; suburb?: string | null },
  b: { scheduledAt: string | Date; suburb?: string | null },
): number {
  const timeDiff = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  if (timeDiff !== 0) return timeDiff;
  return (a.suburb ?? "").localeCompare(b.suburb ?? "");
}

/** Sort by `order` and re-index 0..n-1 (dedupes on taskId+kind, keeps first). */
export function normalizeStops<T extends { taskId: string; kind: RouteStopKind; order: number }>(
  stops: T[],
): T[] {
  const seen = new Set<string>();
  const sorted = [...stops].sort((a, b) => a.order - b.order);
  const out: T[] = [];
  for (const stop of sorted) {
    const key = `${stop.taskId}:${stop.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...stop, order: out.length });
  }
  return out;
}

/** First stop (by order) without a completedAt stamp. */
export function nextIncompleteStop<T extends { order: number; completedAt?: string | null }>(
  stops: T[],
): T | null {
  return (
    [...stops]
      .sort((a, b) => a.order - b.order)
      .find((s) => !s.completedAt) ?? null
  );
}

export type ProjectableStop = {
  lat: number | null;
  lng: number | null;
};

/**
 * Cumulative projected arrival times for an ordered stop list starting at
 * `startAt`. Legs: haversine / NAIVE_SPEED_KMH; each stop then costs
 * NAIVE_PER_STOP_MIN minutes before departing to the next. Stops without
 * coordinates cost 0 travel (the previous known position carries forward).
 */
export function projectArrivalTimes(
  stops: ProjectableStop[],
  opts: { startAt: Date; startLat?: number | null; startLng?: number | null },
): Date[] {
  const arrivals: Date[] = [];
  let clockMs = opts.startAt.getTime();
  let prevLat = typeof opts.startLat === "number" ? opts.startLat : null;
  let prevLng = typeof opts.startLng === "number" ? opts.startLng : null;

  for (const stop of stops) {
    const hasCoords = typeof stop.lat === "number" && typeof stop.lng === "number";
    if (hasCoords && prevLat != null && prevLng != null) {
      const meters = haversine(prevLat, prevLng, stop.lat as number, stop.lng as number);
      const hours = meters / 1000 / NAIVE_SPEED_KMH;
      clockMs += hours * 3_600_000;
    }
    arrivals.push(new Date(clockMs));
    clockMs += NAIVE_PER_STOP_MIN * 60_000;
    if (hasCoords) {
      prevLat = stop.lat as number;
      prevLng = stop.lng as number;
    }
  }
  return arrivals;
}

export type DeadlineStop = ProjectableStop & {
  taskId: string;
  kind: RouteStopKind;
  propertyName: string;
  /** Absolute instant the drop must land by (clean start), DROP stops only. */
  deadlineAt?: Date | null;
  /** "HH:mm" label for the flag message. */
  deadlineLabel?: string | null;
};

export type DeadlineFlag = {
  taskId: string;
  propertyName: string;
  deadlineLabel: string;
  projectedArrival: Date;
};

/**
 * Flag DROP stops whose cumulative projected arrival exceeds their clean-start
 * deadline. `stops` must already be in run order.
 */
export function computeDropDeadlineFlags(
  stops: DeadlineStop[],
  opts: { startAt: Date; startLat?: number | null; startLng?: number | null },
): DeadlineFlag[] {
  const arrivals = projectArrivalTimes(stops, opts);
  const flags: DeadlineFlag[] = [];
  stops.forEach((stop, i) => {
    if (stop.kind !== "DROP" || !stop.deadlineAt) return;
    if (arrivals[i].getTime() > stop.deadlineAt.getTime()) {
      flags.push({
        taskId: stop.taskId,
        propertyName: stop.propertyName,
        deadlineLabel: stop.deadlineLabel ?? "",
        projectedArrival: arrivals[i],
      });
    }
  });
  return flags;
}

/** Parse a LaundryRoute.stops JSON column defensively into the lean shape. */
export function parseRouteStops(value: unknown): RouteStopJson[] {
  if (!Array.isArray(value)) return [];
  const out: RouteStopJson[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.taskId !== "string" || typeof r.propertyId !== "string") continue;
    if (r.kind !== "PICKUP" && r.kind !== "DROP") continue;
    out.push({
      taskId: r.taskId,
      kind: r.kind,
      order: typeof r.order === "number" ? r.order : out.length,
      propertyId: r.propertyId,
      arrivedAt: typeof r.arrivedAt === "string" ? r.arrivedAt : null,
      completedAt: typeof r.completedAt === "string" ? r.completedAt : null,
    });
  }
  return normalizeStops(out);
}
