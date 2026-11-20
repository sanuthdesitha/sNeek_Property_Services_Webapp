import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

const schema = z.object({ locationId: z.string().min(1), propertyId: z.string().min(1).nullable() }).strict();

/**
 * Link a Ring location or Minut home to a property, or unlink it (ADMIN).
 * The office always chooses: a suggestion is never linked without this call.
 * Devices of an unlinked location are left as they are; the next sync adds
 * the devices of a newly linked one.
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = schema.parse(await req.json().catch(() => null));
    const location = await db.deviceProviderLocation.findUnique({ where: { id: body.locationId }, select: { id: true, provider: true, propertyId: true } });
    if (!location) return NextResponse.json({ error: "Location not found. Sync again to refresh the list." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    if (body.propertyId) {
      const property = await db.property.findUnique({ where: { id: body.propertyId }, select: { id: true } });
      if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    }
    await db.deviceProviderLocation.update({
      where: { id: location.id },
      data: body.propertyId ? { propertyId: body.propertyId, confirmedById: session.user.id, confirmedAt: new Date() } : { propertyId: null, confirmedById: null, confirmedAt: null },
    });
    await db.auditLog.create({ data: { userId: session.user.id, action: "DEVICE_PROVIDER_LOCATION_LINKED", entity: "DeviceProviderLocation", entityId: location.id, before: { propertyId: location.propertyId }, after: { propertyId: body.propertyId, provider: location.provider } } });
    return NextResponse.json({ ok: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
