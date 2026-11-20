import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listDeviceAttention } from "@/lib/property-devices/views";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

/** Devices needing attention across properties (Properties page). ADMIN, or a manager with the Properties pack. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await listDeviceAttention(), { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
