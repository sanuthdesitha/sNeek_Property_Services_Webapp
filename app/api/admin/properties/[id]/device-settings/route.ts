import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { evaluateDevice } from "@/lib/property-devices/charge-service";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

const schema = z.object({ thresholdPercent: z.number().int().min(1).max(99).nullable() }).strict();

/** The property's low-battery threshold (null: the organisation default). ADMIN only. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = schema.parse(await req.json().catch(() => null));
    const before = await db.property.findUnique({ where: { id: params.id }, select: { deviceBatteryThresholdPercent: true } });
    if (!before) return NextResponse.json({ error: "Property not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    await db.property.update({ where: { id: params.id }, data: { deviceBatteryThresholdPercent: body.thresholdPercent } });
    await db.auditLog.create({ data: { userId: session.user.id, action: "PROPERTY_DEVICE_THRESHOLD_UPDATED", entity: "Property", entityId: params.id, before: { thresholdPercent: before.deviceBatteryThresholdPercent }, after: { thresholdPercent: body.thresholdPercent } } });
    const devices = await db.propertyDevice.findMany({ where: { propertyId: params.id, isActive: true, batteryPowered: true }, select: { id: true } });
    for (const device of devices) await evaluateDevice(device.id);
    return NextResponse.json({ ok: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
