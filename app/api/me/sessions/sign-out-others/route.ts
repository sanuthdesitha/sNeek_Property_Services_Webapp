import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { SignOutOthersError, signOutEverywhereElse } from "@/lib/auth/sign-in-records";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * POST { security: { pin } | { password } } — "Sign out everywhere else"
 * (tier C, the person's own PIN or password in the same request). Revokes
 * every other recorded sign-in of the caller and refuses older unrecorded
 * tokens from now on; this browser stays signed in. Refused while testing as
 * someone else. Audited as SESSIONS_SIGNED_OUT_ELSEWHERE.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const refusal = await routeSecurityRefusal(session, securityFromBody(body) ?? null);
    if (refusal) return refusal;
    const result = await signOutEverywhereElse(session.user.id, session.signInId ?? null);
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (err: unknown) {
    if (err instanceof SignOutOthersError) return NextResponse.json({ error: err.message }, { status: err.status, headers });
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Nothing was signed out. Try again." : (err as Error).message }, { status, headers });
  }
}
