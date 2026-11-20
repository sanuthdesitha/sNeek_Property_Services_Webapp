import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, routeSecuritySchema } from "@/lib/security/route-verification";
import { disconnectProvider } from "@/lib/property-devices/connections";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";
import { CONNECTED_PROVIDERS } from "@/lib/property-devices/types";

export const dynamic = "force-dynamic";

const schema = z.object({ provider: z.enum(CONNECTED_PROVIDERS), security: routeSecuritySchema }).strict();

/** Disconnect Ring or Minut: forgets the stored sign-in. Devices and readings stay. Tier C. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Choose Ring or Minut and confirm with your PIN." }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
    const refusal = await routeSecurityRefusal(session, parsed.data.security ?? null);
    if (refusal) return refusal;
    await disconnectProvider(session.user.id, parsed.data.provider);
    return NextResponse.json({ ok: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
