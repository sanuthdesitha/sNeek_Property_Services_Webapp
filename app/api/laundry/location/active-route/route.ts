import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { TRACKING_REFUSAL_TEXT, resolveDriverWindow } from "@/lib/gps/tracking-window";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * "Should this driver's phone share its location now?" — polled by the
 * tracker in the laundry portal layout. Yes only while the driver has an
 * ACTIVE route dated today (lib/gps/tracking-window); never while an
 * administrator is viewing as them. A failure answers "no" (fail closed).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.LAUNDRY]);
    const window = await resolveDriverWindow({ userId: session.user.id, role: session.user.role, impersonating: Boolean(session.impersonation) });
    return NextResponse.json({
      tracking: window.ok
        ? { active: true, routeId: window.route.id }
        : { active: false, reason: window.reason, message: TRACKING_REFUSAL_TEXT[window.reason] },
    }, { headers: privateHeaders });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ tracking: { active: false } }, { status, headers: privateHeaders });
  }
}
