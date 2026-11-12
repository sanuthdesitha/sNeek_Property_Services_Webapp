import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { getAppSettings } from "@/lib/settings";
import { addDaysToKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";

export const dynamic = "force-dynamic";

const DRIVER_WINDOW_MS = 15 * 60_000;

/**
 * Live snapshot for the admin laundry "Live" view, polled every ~15s:
 *  - latest GPS ping per LAUNDRY-role user from the last 15 minutes
 *  - today's pickup/dropoff stops with statuses + timestamps
 *  - tasks overdue at the laundromat (picked up > maxOutdoorDays ago)
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const now = new Date();

    // Today's stops by the Sydney calendar day. This read the SERVER's local
    // midnight, so on a UTC host "today" ran from 10/11am Sydney time and a
    // morning stop showed under the wrong day.
    const todayKey = sydneyTodayKey(now);
    const dayStart = sydneyDayStart(todayKey);
    const dayEnd = sydneyDayStart(addDaysToKey(todayKey, 1));

    const [drivers, tasks, settings] = await Promise.all([
      db.cleanerLocationPing.findMany({
        where: {
          timestamp: { gte: new Date(now.getTime() - DRIVER_WINDOW_MS) },
          user: { role: Role.LAUNDRY },
        },
        orderBy: { timestamp: "desc" },
        distinct: ["userId"],
        select: {
          userId: true,
          lat: true,
          lng: true,
          accuracy: true,
          timestamp: true,
          user: { select: { id: true, name: true } },
        },
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
