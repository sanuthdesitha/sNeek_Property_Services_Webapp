import "server-only";
import { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { sydneyDayKey } from "./route-candidates";
import { parseRouteStops } from "./route-plan";
import { latestBagCount, latestReadiness } from "./pipeline";
import { laundryTaskScope } from "./teams";
import type { LaundryOfficeRequest } from "./office-request-types";
import { buildTodayStops, officeAskFor, orderUnroutedStops, type TodayStop, type TodayStopFacts } from "./today-stops";

/**
 * The signed-in laundry team member's stops for today (laundry portal Today):
 * the ACTIVE route (or the latest DRAFT) in route order; without one, today's
 * scoped pickups and drop-offs by planned time. Visibility: the same laundry
 * scope as every portal board (laundryTaskScope). Reads only.
 *
 * Owner decision 2026-11-13: with `today` (the Runs board's today set,
 * lib/laundry/today-runs.ts) only runs scheduled today are shown. A route
 * stop for a run from another day (an overdue or failed set added to the
 * route) is left off Today and counted in `otherDayStops`; it stays on the
 * route builder, Tracking and Queue. Without a route, the stops are exactly
 * today's pickup and drop-off loops (before: every overdue open set).
 */
export type TodayRoute = {
  mode: "active" | "draft" | "none";
  startedAtLabel: string | null;
  stops: TodayStop[];
  /** Route stops left off Today because their run is not scheduled today. */
  otherDayStops: number;
};

/** Today's runs by loop (task ids), from the Runs rule. */
export type TodayRunIds = { pickupIds: ReadonlySet<string>; dropIds: ReadonlySet<string> };

const stopTaskSelect = {
  id: true, status: true, pickupDate: true, dropoffDate: true, pickupTime: true, dropoffTime: true, pickedUpAt: true, droppedAt: true, dropoffCostAud: true, noPickupRequired: true,
  property: { select: { name: true, address: true, suburb: true } },
  confirmations: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { laundryReady: true, photoUrl: true, notes: true, bagLocation: true, createdAt: true } },
} satisfies Prisma.LaundryTaskSelect;

type StopTask = Prisma.LaundryTaskGetPayload<{ select: typeof stopTaskSelect }>;

function eventOf(notes: string | null): string | null {
  try {
    const meta = JSON.parse(notes ?? "") as { event?: unknown };
    return typeof meta?.event === "string" ? meta.event : null;
  } catch {
    return null;
  }
}

function factsFor(task: StopTask, kind: "PICKUP" | "DROP", completedAt: string | null, requests: LaundryOfficeRequest[] | null): TodayStopFacts {
  const confirmations = task.confirmations ?? [];
  const drop = [...confirmations].reverse().find((row) => eventOf(row.notes) === "DROPPED");
  const handoff = [...confirmations].reverse().find((row) => row.bagLocation);
  const address = [task.property?.address, task.property?.suburb].filter(Boolean).join(", ") || null;
  return {
    taskId: task.id,
    kind,
    propertyName: task.property?.name ?? "Property",
    address,
    plannedTime: kind === "PICKUP" ? task.pickupTime ?? null : task.dropoffTime ?? null,
    completedAt: completedAt ?? (kind === "PICKUP" ? task.pickedUpAt?.toISOString() ?? null : task.droppedAt?.toISOString() ?? null),
    status: task.status,
    bagCount: latestBagCount(confirmations),
    readiness: latestReadiness(confirmations),
    bagLocation: kind === "DROP" ? drop?.bagLocation ?? null : handoff?.bagLocation ?? null,
    hasDropPhoto: Boolean(drop?.photoUrl),
    receiptAud: task.dropoffCostAud ?? null,
    officeAsked: officeAskFor(task.id, requests),
    nextGuestDay: null,
  };
}

const clock = (iso: string) => formatInTimeZone(new Date(iso), SYDNEY_TZ, "H:mm");

export async function loadTodayRoute(viewer: { id: string; role: string }, requests: LaundryOfficeRequest[] | null, today: TodayRunIds, now = new Date()): Promise<TodayRoute> {
  const scope = await laundryTaskScope(viewer);
  const routes = await db.laundryRoute.findMany({ where: { userId: viewer.id, date: sydneyDayKey(now), status: { in: ["ACTIVE", "DRAFT"] } } });
  const route = routes.find((row) => row.status === "ACTIVE") ?? [...routes].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;

  if (route) {
    const stops = [...parseRouteStops(route.stops)].sort((a, b) => a.order - b.order);
    const tasks = await db.laundryTask.findMany({ where: { ...scope, id: { in: stops.map((stop) => stop.taskId) } }, select: stopTaskSelect });
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const scheduledToday = (taskId: string) => today.pickupIds.has(taskId) || today.dropIds.has(taskId);
    const facts = stops.flatMap((stop) => {
      const task = byId.get(stop.taskId);
      return task && scheduledToday(task.id) ? [factsFor(task, stop.kind, stop.completedAt ?? null, requests)] : [];
    });
    return {
      mode: route.status === "ACTIVE" ? "active" : "draft",
      startedAtLabel: route.startedAt ? clock(route.startedAt.toISOString()) : null,
      stops: buildTodayStops(facts, clock),
      otherDayStops: stops.filter((stop) => byId.has(stop.taskId) && !scheduledToday(stop.taskId)).length,
    };
  }

  // No route: exactly today's pickup and drop-off loops (the Runs rule), by planned time.
  const ids = Array.from(new Set([...Array.from(today.pickupIds), ...Array.from(today.dropIds)]));
  const tasks = ids.length ? await db.laundryTask.findMany({ where: { ...scope, id: { in: ids } }, select: stopTaskSelect }) : [];
  const facts = tasks.flatMap((task) => [
    ...(today.pickupIds.has(task.id) ? [factsFor(task, "PICKUP", null, requests)] : []),
    ...(today.dropIds.has(task.id) ? [factsFor(task, "DROP", null, requests)] : []),
  ]);
  return { mode: "none", startedAtLabel: null, stops: buildTodayStops(orderUnroutedStops(facts), clock), otherDayStops: 0 };
}
