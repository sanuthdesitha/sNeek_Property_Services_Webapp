import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listPropertyDevices } from "@/lib/property-devices/views";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";
import { DEVICE_KINDS } from "@/lib/property-devices/types";

export const dynamic = "force-dynamic";

/**
 * A property's devices (2026-11-20). ADMIN, or an operations manager whose
 * Properties pack allows it (read to view, manage to add); requireRole
 * re-checks the live role and pack on every call.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listPropertyDevices(params.id), { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}

const createSchema = z.object({
  requestId: z.string().uuid(),
  name: z.string().trim().min(1, "Give the device a name.").max(120),
  kind: z.enum(DEVICE_KINDS),
  locationNote: z.string().trim().max(300).nullable().optional(),
  batteryPowered: z.boolean(),
  thresholdPercent: z.number().int().min(1).max(99).nullable().optional(),
}).strict();

/** Add a device by hand (the manual fallback). Idempotent on requestId. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => null));
    if (body.thresholdPercent != null && session.user.role !== Role.ADMIN) {
      return NextResponse.json({ error: "Only an administrator sets a device's own threshold." }, { status: 403, headers: DEVICE_ROUTE_HEADERS });
    }
    const property = await db.property.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    const id = `manual-device-${params.id}-${body.requestId}`;
    const existing = await db.propertyDevice.findUnique({ where: { id }, select: { id: true, name: true } });
    if (existing) {
      if (existing.name !== body.name) return NextResponse.json({ error: "This device was already added with different details. Reload before adding it again." }, { status: 409, headers: DEVICE_ROUTE_HEADERS });
      return NextResponse.json({ id: existing.id, created: false }, { headers: DEVICE_ROUTE_HEADERS });
    }
    const device = await db.$transaction(async (tx) => {
      const created = await tx.propertyDevice.create({
        data: {
          id, propertyId: property.id, provider: "MANUAL", name: body.name, kind: body.kind,
          locationNote: body.locationNote?.trim() || null, batteryPowered: body.batteryPowered,
          thresholdPercent: body.thresholdPercent ?? null, createdById: session.user.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({ data: { userId: session.user.id, action: "PROPERTY_DEVICE_ADDED", entity: "PropertyDevice", entityId: created.id, after: { propertyId: property.id, name: body.name, kind: body.kind, batteryPowered: body.batteryPowered } } });
      return created;
    });
    return NextResponse.json({ id: device.id, created: true }, { status: 201, headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
