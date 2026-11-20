import { NextRequest, NextResponse } from "next/server";
import { Role, type Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { closeConditionByOffice, evaluateDevice } from "@/lib/property-devices/charge-service";
import { listDeviceReadings } from "@/lib/property-devices/views";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";
import { DEVICE_KINDS } from "@/lib/property-devices/types";

export const dynamic = "force-dynamic";

async function deviceAtProperty(propertyId: string, deviceId: string) {
  const device = await db.propertyDevice.findUnique({ where: { id: deviceId }, select: { id: true, propertyId: true, provider: true, name: true, kind: true, locationNote: true, batteryPowered: true, thresholdPercent: true, isActive: true, updatedAt: true } });
  return device && device.propertyId === propertyId ? device : null;
}

/** The device's readings history (newest first). */
export async function GET(_req: NextRequest, { params }: { params: { id: string; deviceId: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (!(await deviceAtProperty(params.id, params.deviceId))) return NextResponse.json({ error: "Device not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    return NextResponse.json({ readings: await listDeviceReadings(params.deviceId) }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}

const patchSchema = z.object({
  expectedUpdatedAt: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(DEVICE_KINDS).optional(),
  locationNote: z.string().trim().max(300).nullable().optional(),
  batteryPowered: z.boolean().optional(),
  thresholdPercent: z.number().int().min(1).max(99).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();

/**
 * Edit a device. Name, kind, place, battery-powered and in use: ADMIN or a
 * manager with Properties manage. The device's own threshold: ADMIN only.
 * Taking a device out of use closes an open charge with that note and cancels
 * its open task.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; deviceId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => null));
    const device = await deviceAtProperty(params.id, params.deviceId);
    if (!device) return NextResponse.json({ error: "Device not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    if (body.thresholdPercent !== undefined && session.user.role !== Role.ADMIN) {
      return NextResponse.json({ error: "Only an administrator sets a device's own threshold." }, { status: 403, headers: DEVICE_ROUTE_HEADERS });
    }
    if (device.updatedAt.toISOString() !== body.expectedUpdatedAt) {
      return NextResponse.json({ error: "This device changed since you opened it. Reload, then make your change again.", code: "STALE" }, { status: 409, headers: DEVICE_ROUTE_HEADERS });
    }
    const data: Prisma.PropertyDeviceUpdateInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.locationNote !== undefined ? { locationNote: body.locationNote?.trim() || null } : {}),
      ...(body.batteryPowered !== undefined ? { batteryPowered: body.batteryPowered } : {}),
      ...(body.thresholdPercent !== undefined ? { thresholdPercent: body.thresholdPercent } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    };
    const updated = await db.propertyDevice.updateMany({ where: { id: device.id, updatedAt: device.updatedAt }, data: data as Prisma.PropertyDeviceUpdateManyMutationInput });
    if (updated.count !== 1) return NextResponse.json({ error: "This device changed since you opened it. Reload, then make your change again.", code: "STALE" }, { status: 409, headers: DEVICE_ROUTE_HEADERS });
    await db.auditLog.create({ data: { userId: session.user.id, action: "PROPERTY_DEVICE_UPDATED", entity: "PropertyDevice", entityId: device.id, before: { name: device.name, kind: device.kind, batteryPowered: device.batteryPowered, thresholdPercent: device.thresholdPercent, isActive: device.isActive }, after: data as Prisma.InputJsonValue } });
    if (body.isActive === false || body.batteryPowered === false) {
      await closeConditionByOffice(device.id, session.user.id, body.isActive === false ? "Device taken out of use." : "Device marked as wired (no battery).");
    } else {
      await evaluateDevice(device.id);
    }
    return NextResponse.json({ ok: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
