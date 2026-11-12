import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { getAppSettings } from "@/lib/settings";
import { addDaysToKey, sydneyDayEndInclusive, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { getOpsAccess } from "@/lib/rbac/ops-access";
import { parseRouteStops } from "@/lib/laundry/route-plan";

export const dynamic = "force-dynamic";

/**
 * Live snapshot for the office laundry "Live" view, polled every ~15s:
 *  - every driver with an ACTIVE route today: their latest position
 *    (UserLastLocation: measured time, accuracy, what the phone reported),
 *    route progress and the route's stops with coordinates — the office map
 *    of where the drivers are (it used to embed the driver's own route screen,
 *    which loaded the VIEWER's route and offered the office "Share GPS")
 *  - today's pickup/dropoff stops with statuses + timestamps
 *  - tasks overdue at the laundromat (picked up > maxOutdoorDays ago)
 * Laundry pack at read (re-checked here, not only in middleware).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const levels = await getOpsAccess(session.user);
    if (levels && levels.laundry !== "read" && levels.laundry !== "manage") throw new Error("FORBIDDEN");
    const now = new Date();

    // Today's stops by the Sydney calendar day. This read the SERVER's local
    // midnight, so on a UTC host "today" ran from 10/11am Sydney time and a
    // morning stop showed under the wrong day.
    const todayKey = sydneyTodayKey(now);
    const dayStart = sydneyDayStart(todayKey);
    const dayEnd = sydneyDayStart(addDaysToKey(todayKey, 1));

    const [routes, tasks, settings] = await Promise.all([
      db.laundryRoute.findMany({
        where: { status: "ACTIVE", date: { gte: dayStart, lte: sydneyDayEndInclusive(todayKey) } },
        select: { id: true, userId: true, stops: true, startedAt: true, user: { select: { id: true, name: true, email: true, phone: true } } },
      }),
      db.laundryTask.findMany({
        where: {
          OR: [
            { pickupDate: { gte: dayStart, lt: dayEnd } },
            { dropoffDate: { gte: dayStart, lt: dayEnd } },
          ],
        },
        select: {
          id: true,
          status: true,
          pickupDate: true,
          dropoffDate: true,
          pickedUpAt: true,
          droppedAt: true,
          flagReason: true,
          property: {
            select: {
              id: true,
              name: true,
              address: true,
              suburb: true,
              latitude: true,
              longitude: true,
            },
          },
        },
        orderBy: { pickupDate: "asc" },
      }),
      getAppSettings(),
    ]);

    const [locations, stopProperties] = await Promise.all([
      routes.length
        ? db.userLastLocation.findMany({
            where: { userId: { in: routes.map((route) => route.userId) } },
            select: { userId: true, lat: true, lng: true, accuracy: true, measuredAt: true, trackingState: true, trackingStateAt: true },
          })
        : Promise.resolve([]),
      routes.length
        ? db.property.findMany({
            where: { id: { in: Array.from(new Set(routes.flatMap((route) => parseRouteStops(route.stops).map((stop) => stop.propertyId)))) } },
            select: { id: true, name: true, suburb: true, latitude: true, longitude: true },
          })
        : Promise.resolve([]),
    ]);
    const locationBy = new Map(locations.map((row) => [row.userId, row]));
    const propertyBy = new Map(stopProperties.map((row) => [row.id, row]));
    const drivers = routes.map((route) => {
      const stops = parseRouteStops(route.stops);
      const location = locationBy.get(route.userId) ?? null;
      return {
        userId: route.userId,
        routeId: route.id,
        user: { id: route.user.id, name: route.user.name ?? route.user.email },
        phone: route.user.phone ?? null,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
        accuracy: location?.accuracy ?? null,
        timestamp: location?.measuredAt?.toISOString() ?? null,
        trackingState: location?.trackingState ?? null,
        trackingStateAt: location?.trackingStateAt?.toISOString() ?? null,
        stopsDone: stops.filter((stop) => stop.completedAt).length,
        stopsTotal: stops.length,
        stops: stops.map((stop) => {
          const property = propertyBy.get(stop.propertyId);
          return {
            taskId: stop.taskId, kind: stop.kind, order: stop.order,
            propertyName: property?.name ?? "Property", suburb: property?.suburb ?? null,
            lat: property?.latitude ?? null, lng: property?.longitude ?? null,
            arrivedAt: stop.arrivedAt ?? null, completedAt: stop.completedAt ?? null,
          };
        }),
      };
    });

    const maxOutdoorDays = settings.laundryOperations?.maxOutdoorDays ?? 3;
    const overdueCutoff = new Date(now.getTime() - maxOutdoorDays * 24 * 60 * 60 * 1000);

    const overdueAtLaundry = await db.laundryTask.findMany({
      // Out too long: picked up or "Ready to return" (still not delivered).
      where: { status: { in: ["PICKED_UP", "READY_TO_RETURN"] }, pickedUpAt: { lt: overdueCutoff } },
      select: {
        id: true,
        pickedUpAt: true,
        dropoffDate: true,
        property: { select: { name: true, suburb: true } },
      },
      orderBy: { pickedUpAt: "asc" },
      take: 20,
    });

    return NextResponse.json({
      now: now.toISOString(),
      maxOutdoorDays,
      drivers,
      tasks,
      overdueAtLaundry,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
