import { addDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";

const TZ = "Australia/Sydney";
const MAX_BOOKINGS_PER_DAY = 8;
/** How far ahead a client may book. Reported to the UI as windowStart/windowEnd. */
const BOOKING_WINDOW_DAYS = 30;

const schema = z.object({
  propertyId: z.string().trim().min(1),
  serviceType: z.string().trim().min(1),
});

export async function GET(req: NextRequest) {
  try {
    // Booking is a VA-grantable action, so a VA needs the `bookings`
    // permission; a CLIENT always holds it. requireClientPortal also
    // guarantees a clientId, so the old null check is no longer reachable.
    const portal = await requireClientPortal({ permission: "bookings" });
    if (!isClientModuleEnabled(portal.visibility, "booking")) {
      return NextResponse.json({ error: "Booking is disabled for this client." }, { status: 403 });
    }

    const query = schema.parse({
      propertyId: req.nextUrl.searchParams.get("propertyId"),
      serviceType: req.nextUrl.searchParams.get("serviceType"),
    });

    const property = await db.property.findFirst({
      where: {
        id: query.propertyId,
        clientId: portal.clientId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const nowLocal = toZonedTime(new Date(), TZ);
    const startUtc = fromZonedTime(
      new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), 0, 0, 0, 0),
      TZ
    );
    const endLocal = addDays(new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), 0, 0, 0, 0), 31);
    const endUtc = fromZonedTime(endLocal, TZ);

    const rows = await db.job.findMany({
      where: {
        scheduledDate: {
          gte: startUtc,
          lt: endUtc,
        },
      },
      select: {
        scheduledDate: true,
      },
    });

    const countByDay = new Map<string, number>();
    for (const row of rows) {
      const key = format(toZonedTime(row.scheduledDate, TZ), "yyyy-MM-dd");
      countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
    }

    const startLocal = new Date(
      nowLocal.getFullYear(),
      nowLocal.getMonth(),
      nowLocal.getDate(),
      0,
      0,
      0,
      0
    );

    const available: string[] = [];
    for (let offset = 0; offset < BOOKING_WINDOW_DAYS; offset += 1) {
      const candidateLocal = addDays(startLocal, offset);
      const key = format(candidateLocal, "yyyy-MM-dd");
      if ((countByDay.get(key) ?? 0) < MAX_BOOKINGS_PER_DAY) {
        available.push(key);
      }
    }

    // The window bounds travel with the list. `available` only says which days
    // ARE bookable — an unavailable day and a day outside the booking window
    // are both simply absent, which a flat list of buttons never had to tell
    // apart but a calendar does: without these, every day in the surrounding
    // month renders disabled with no way to explain why.
    return NextResponse.json({
      available,
      windowStart: format(startLocal, "yyyy-MM-dd"),
      windowEnd: format(addDays(startLocal, BOOKING_WINDOW_DAYS - 1), "yyyy-MM-dd"),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Could not load booking availability." },
      { status: error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
