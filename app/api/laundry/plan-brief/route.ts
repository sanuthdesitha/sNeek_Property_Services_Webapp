/**
 * GET /api/laundry/plan-brief — the driver's morning plan brief.
 *
 * → {
 *     counts: { today: {pickups, drops}, tomorrow: {pickups, drops} },
 *     weather: { today, tomorrow },           // lib/briefing/weather, keyless
 *     trafficNote: string | null,             // static AM-peak heuristic
 *     specialDays: { today, tomorrow, next }, // NSW public holidays
 *     deadlineFlags: [{ taskId, propertyName, deadline, projectedArrival }],
 *   }
 *
 * Deadline check: for each of today's DROP tasks the clean start comes from
 * resolveCleanStart(job, property); the projected arrival is the cumulative
 * NAIVE model (haversine / 35 km/h + 7 min per stop — deliberately no Distance
 * Matrix) over the driver's ACTIVE route order, else time+suburb order.
 */
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { getBriefingWeather } from "@/lib/briefing/weather";
import { resolveCleanStart } from "@/lib/laundry/clean-start";
import { fetchLaundryWeekTasks, type LaundryWeekTask } from "@/lib/laundry/week-feed";
import { sydneyDayKey } from "@/lib/laundry/route-candidates";
import {
  compareByTimeThenSuburb,
  computeDropDeadlineFlags,
  parseRouteStops,
  type DeadlineStop,
  type RouteStopKind,
} from "@/lib/laundry/route-plan";

export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";
const DAY_MS = 86_400_000;
const AM_PEAK_CUTOFF_MIN = 9 * 60 + 30; // 09:30 Sydney

const PICKUP_OPEN = ["PENDING", "CONFIRMED"];
const DROP_CLOSED = ["DROPPED", "SKIPPED_PICKUP"];

type BriefStop = {
  taskId: string;
  kind: RouteStopKind;
  propertyName: string;
  suburb: string | null;
  lat: number | null;
  lng: number | null;
  scheduledAt: string;
};

function inWindow(value: Date, start: Date, end: Date): boolean {
  return value.getTime() >= start.getTime() && value.getTime() < end.getTime();
}

function stopsFromTasks(tasks: LaundryWeekTask[], start: Date, end: Date): BriefStop[] {
  const stops: BriefStop[] = [];
  for (const task of tasks) {
    const prop = task.property;
    const base = {
      taskId: task.id,
      propertyName: prop?.name ?? "Unknown property",
      suburb: prop?.suburb ?? null,
      lat: typeof prop?.latitude === "number" ? prop.latitude : null,
      lng: typeof prop?.longitude === "number" ? prop.longitude : null,
    };
    if (
      !task.noPickupRequired &&
      PICKUP_OPEN.includes(task.status) &&
      inWindow(task.pickupDate, start, end)
    ) {
      stops.push({ ...base, kind: "PICKUP", scheduledAt: task.pickupDate.toISOString() });
    }
    if (!DROP_CLOSED.includes(task.status) && inWindow(task.dropoffDate, start, end)) {
      stops.push({ ...base, kind: "DROP", scheduledAt: task.dropoffDate.toISOString() });
    }
  }
  return stops.sort(compareByTimeThenSuburb);
}

export async function GET() {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const viewer = { role: session.user.role, userId: session.user.id };
    const now = new Date();
    const todayKey = sydneyDayKey(now);
    const tomorrowKey = new Date(todayKey.getTime() + DAY_MS);
    const endKey = new Date(todayKey.getTime() + 2 * DAY_MS);

    const tasks = await fetchLaundryWeekTasks(todayKey, endKey, viewer);

    const todayStops = stopsFromTasks(tasks, todayKey, tomorrowKey);
    const tomorrowStops = stopsFromTasks(tasks, tomorrowKey, endKey);

    // ACTIVE route order wins for today's projection when one exists.
    const activeRoute = await db.laundryRoute.findFirst({
      where: { userId: session.user.id, status: "ACTIVE", date: todayKey },
      orderBy: { startedAt: "desc" },
    });
    let orderedToday: BriefStop[] = todayStops;
    if (activeRoute) {
      const byKey = new Map(todayStops.map((s) => [`${s.taskId}:${s.kind}`, s]));
      const routeOrdered = parseRouteStops(activeRoute.stops)
        .filter((s) => !s.completedAt)
        .map((s) => byKey.get(`${s.taskId}:${s.kind}`))
        .filter((s): s is BriefStop => Boolean(s));
      if (routeOrdered.length > 0) orderedToday = routeOrdered;
    }

    // Weather at the first stop's coords (else Sydney default inside the helper).
    const firstWithCoords = orderedToday.find((s) => s.lat != null && s.lng != null);
    const [weatherToday, weatherTomorrow] = await Promise.all([
      getBriefingWeather({
        latitude: firstWithCoords?.lat,
        longitude: firstWithCoords?.lng,
        dayOffset: 0,
      }),
      getBriefingWeather({
        latitude: firstWithCoords?.lat,
        longitude: firstWithCoords?.lng,
        dayOffset: 1,
      }),
    ]);

    // Static traffic heuristic: an early first stop rides the AM peak.
    let trafficNote: string | null = null;
    const first = orderedToday[0];
    if (first) {
      const zoned = toZonedTime(new Date(first.scheduledAt), TZ);
      if (zoned.getHours() * 60 + zoned.getMinutes() < AM_PEAK_CUTOFF_MIN) {
        trafficNote = "First stop is before 09:30 — allow a +20% AM peak buffer.";
      }
    }

    // NSW special days (static table; no util existed in lib/).
    const { nswPublicHolidayName, nextSpecialDay } = await import("@/lib/dates/au-nsw-holidays");
    const todayIso = format(toZonedTime(now, TZ), "yyyy-MM-dd");
    const tomorrowIso = format(
      toZonedTime(new Date(now.getTime() + DAY_MS), TZ),
      "yyyy-MM-dd",
    );
    const specialDays = {
      today: nswPublicHolidayName(todayIso),
      tomorrow: nswPublicHolidayName(tomorrowIso),
      next: nextSpecialDay(todayIso),
    };

    // Deadline check — clean starts need job timing fields the week feed
    // deliberately doesn't carry (internalNotes is admin-only), so fetch lean.
    const dropTaskIds = orderedToday.filter((s) => s.kind === "DROP").map((s) => s.taskId);
    const timing = dropTaskIds.length
      ? await db.laundryTask.findMany({
          where: { id: { in: dropTaskIds } },
          select: {
            id: true,
            job: { select: { startTime: true, internalNotes: true } },
            property: { select: { defaultCheckoutTime: true } },
          },
        })
      : [];
    const cleanStartByTask = new Map(
      timing.map((t) => [t.id, resolveCleanStart(t.job ?? {}, t.property)]),
    );

    const deadlineStops: DeadlineStop[] = orderedToday.map((s) => {
      const hhmm = s.kind === "DROP" ? cleanStartByTask.get(s.taskId) : undefined;
      return {
        taskId: s.taskId,
        kind: s.kind,
        propertyName: s.propertyName,
        lat: s.lat,
        lng: s.lng,
        deadlineAt: hhmm ? fromZonedTime(`${todayIso}T${hhmm}:00`, TZ) : null,
        deadlineLabel: hhmm ?? null,
      };
    });
    const deadlineFlags = computeDropDeadlineFlags(deadlineStops, { startAt: now }).map(
      (flag) => ({
        taskId: flag.taskId,
        propertyName: flag.propertyName,
        deadline: flag.deadlineLabel,
        projectedArrival: format(toZonedTime(flag.projectedArrival, TZ), "HH:mm"),
      }),
    );

    const countStops = (stops: BriefStop[]) => ({
      pickups: stops.filter((s) => s.kind === "PICKUP").length,
      drops: stops.filter((s) => s.kind === "DROP").length,
    });

    return NextResponse.json({
      counts: { today: countStops(todayStops), tomorrow: countStops(tomorrowStops) },
      weather: { today: weatherToday, tomorrow: weatherTomorrow },
      trafficNote,
      specialDays,
      deadlineFlags,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
