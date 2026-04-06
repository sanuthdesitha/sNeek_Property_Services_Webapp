import { addDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { isClientModuleEnabled } from "@/lib/portal-access";

const TZ = "Australia/Sydney";
const MAX_BOOKINGS_PER_DAY = 8;

const schema = z.object({
  propertyId: z.string().trim().min(1),
  serviceType: z.string().trim().min(1),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!portal.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
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

    const available: string[] = [];
    for (let offset = 0; offset < 30; offset += 1) {
      const candidateLocal = addDays(
        new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate(), 0, 0, 0, 0),
        offset
      );
      const key = format(candidateLocal, "yyyy-MM-dd");
      if ((countByDay.get(key) ?? 0) < MAX_BOOKINGS_PER_DAY) {
        available.push(key);
      }
    }

    return NextResponse.json({ available });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Could not load booking availability." },
      { status: error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
