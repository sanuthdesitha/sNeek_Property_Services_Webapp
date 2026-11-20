import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, routeSecuritySchema } from "@/lib/security/route-verification";
import { connectMinut, saveMinutCredentials } from "@/lib/property-devices/connections";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

const schema = z.object({
  /** Both or neither: leaving them out tests the stored ones. */
  clientId: z.string().trim().min(1).max(300).optional(),
  clientSecret: z.string().trim().min(1).max(500).optional(),
  security: routeSecuritySchema,
}).strict().refine((value) => Boolean(value.clientId) === Boolean(value.clientSecret), "Enter both the client id and the client secret.");

/**
 * Save the Minut API client id and secret (into the integrations credentials)
 * and check them against Minut. Tier C: the administrator's own PIN. The
 * secret is never returned.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
    const refusal = await routeSecurityRefusal(session, parsed.data.security ?? null);
    if (refusal) return refusal;
    if (parsed.data.clientId && parsed.data.clientSecret) {
      await saveMinutCredentials(session.user.id, { clientId: parsed.data.clientId, clientSecret: parsed.data.clientSecret });
    }
    await connectMinut(session.user.id);
    return NextResponse.json({ connected: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
