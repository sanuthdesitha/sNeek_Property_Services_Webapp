import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { connectionViews } from "@/lib/property-devices/connections";
import { readPropertyDeviceSettings, savePropertyDeviceSettings } from "@/lib/property-devices/settings";
import { listProviderLocations } from "@/lib/property-devices/views";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

/**
 * Settings › Ring and Minut devices (2026-11-20). ADMIN only. Returns the
 * thresholds and timings, each connection's honest state (missing
 * configuration in words, last good sync, last error), the provider locations
 * with their linked or suggested property, and recent runs. Never returns a
 * token, password, code or client secret.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
    const settings = await readPropertyDeviceSettings();
    const [connections, locations, runs, properties] = await Promise.all([
      connectionViews(settings),
      listProviderLocations(),
      db.deviceSyncRun.findMany({ orderBy: { createdAt: "desc" }, take: 15, select: { id: true, provider: true, mode: true, status: true, summary: true, error: true, createdAt: true, completedAt: true } }),
      db.property.findMany({ where: { isActive: true }, select: { id: true, name: true, suburb: true }, orderBy: { name: "asc" } }),
    ]);
    return NextResponse.json({ settings, connections, locations, runs, properties }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}

/** Save thresholds and timings (merge). ADMIN only, audited. */
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const settings = await savePropertyDeviceSettings(session.user, await req.json().catch(() => null));
    return NextResponse.json({ settings }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
