import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { reserveRateLimit } from "@/lib/ai/provider/store";
import { routeSecurityRefusal, routeSecuritySchema } from "@/lib/security/route-verification";
import { connectRing } from "@/lib/property-devices/connections";
import { DEVICE_ROUTE_HEADERS, deviceRouteError } from "@/lib/property-devices/route-errors";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().email("Enter the shared Ring account's email."),
  password: z.string().min(1, "Enter the shared Ring account's password.").max(500),
  twoFactorCode: z.string().trim().regex(/^\d{4,8}$/, "Enter the code Ring sent.").optional(),
  security: routeSecuritySchema,
}).strict();

/**
 * Connect Ring with the separate shared account (tier C: the administrator's
 * own PIN, verified here). First call without a code: Ring sends one and this
 * answers `needsCode`. Second call with the code stores ONLY the refresh token
 * (encrypted) and a hardware id. The password and code are used for that one
 * request and are never stored, logged, audited or returned.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const raw = await req.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400, headers: DEVICE_ROUTE_HEADERS });
    const refusal = await routeSecurityRefusal(session, parsed.data.security ?? null);
    if (refusal) return refusal;
    if (!(await reserveRateLimit(`ring-connect:${session.user.id}`, 10, 15 * 60_000))) {
      return NextResponse.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429, headers: DEVICE_ROUTE_HEADERS });
    }
    const result = await connectRing(session.user.id, { email: parsed.data.email, password: parsed.data.password, twoFactorCode: parsed.data.twoFactorCode });
    if (result.kind === "needs_code") return NextResponse.json({ needsCode: true, prompt: result.prompt }, { headers: DEVICE_ROUTE_HEADERS });
    return NextResponse.json({ connected: true }, { headers: DEVICE_ROUTE_HEADERS });
  } catch (error) {
    return deviceRouteError(error);
  }
}
