import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { closeConditionByOffice } from "@/lib/property-devices/charge-service";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

const closeSchema = z.object({ note: z.string().trim().min(1, "Say why the charge is no longer needed.").max(500) }).strict();

/** The office closes an open charge with a note (e.g. device replaced). Cancels the open task. */
export async function POST(req: NextRequest, { params }: { params: { id: string; deviceId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = closeSchema.parse(await req.json().catch(() => null));
    const device = await db.propertyDevice.findUnique({ where: { id: params.deviceId }, select: { propertyId: true } });
    if (!device || device.propertyId !== params.id) return NextResponse.json({ error: "Device not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    await closeConditionByOffice(params.deviceId, session.user.id, body.note);
    await db.auditLog.create({ data: { userId: session.user.id, action: "PROPERTY_DEVICE_CHARGE_CLOSED", entity: "PropertyDevice", entityId: params.deviceId, after: { note: body.note } } });
    return NextResponse.json({ ok: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
