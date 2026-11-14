import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { listSignedInSessions } from "@/lib/auth/sign-in-records";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET — the signed-in office user's own sign-ins (Your profile › Signed-in
 * sessions). Only the caller's rows; while testing as someone else nothing is
 * listed (the page shows its own account and refuses changes).
 */
export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return NextResponse.json({ impersonating: true }, { headers });
    const result = await listSignedInSessions(session.user.id, session.signInId ?? null);
    return NextResponse.json({ impersonating: false, ...result }, { headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Your sessions could not be loaded." : (err as Error).message }, { status, headers });
  }
}
