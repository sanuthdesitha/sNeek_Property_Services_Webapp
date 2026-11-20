import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { recordReading } from "@/lib/property-devices/charge-service";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

const readingSchema = z.object({
  requestId: z.string().uuid(),
  percent: z.number().int("Enter a whole number.").min(0, "Battery is 0 to 100.").max(100, "Battery is 0 to 100."),
  /** When the level was seen; defaults to now. Never in the future. */
  readAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

/**
 * Enter a battery reading by hand (the fallback that always works). ADMIN, or
 * a manager whose Properties pack is at manage. The same threshold rule then
 * runs: at or below the threshold raises one charge task; a reading above it
 * closes an open charge.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; deviceId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = readingSchema.parse(await req.json().catch(() => null));
    const device = await db.propertyDevice.findUnique({ where: { id: params.deviceId }, select: { propertyId: true } });
    if (!device || device.propertyId !== params.id) return NextResponse.json({ error: "Device not found." }, { status: 404, headers: DEVICE_ROUTE_HEADERS });
    const now = new Date();
    const readAt = body.readAt ? new Date(body.readAt) : now;
    if (readAt.getTime() > now.getTime() + 60_000) return NextResponse.json({ error: "A reading cannot be in the future." }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
    const result = await recordReading({
      deviceId: params.deviceId,
      percent: body.percent,
      source: "MANUAL",
      readAt,
      recordedById: session.user.id,
      note: body.note ?? null,
      readingId: `manual-reading-${params.deviceId}-${body.requestId}`,
    });
    return NextResponse.json({ readingId: result.readingId, created: result.created, decision: result.outcome.decision }, { status: result.created ? 201 : 200, headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
