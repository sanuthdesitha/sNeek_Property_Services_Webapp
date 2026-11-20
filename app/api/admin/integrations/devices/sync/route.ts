import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { runProviderSync } from "@/lib/property-devices/sync";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";
import { CONNECTED_PROVIDERS } from "@/lib/property-devices/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({ provider: z.enum(CONNECTED_PROVIDERS) }).strict();

/**
 * Sync now (ADMIN). The same sync the hourly worker runs, one at a time per
 * provider (a second click while one runs answers SKIPPED). Reads only.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose Ring or Minut." }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
    const result = await runProviderSync(parsed.data.provider, { mode: "MANUAL", triggeredById: session.user.id });
    return NextResponse.json(result, { status: result.status === "ERROR" ? 502 : 200, headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
