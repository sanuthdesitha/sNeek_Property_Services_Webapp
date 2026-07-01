import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { verifySensitiveAction } from "@/lib/security/admin-verification";

/**
 * Verify-only endpoint: confirms the caller's admin PIN or password without
 * performing any mutation. Used to gate/unlock sensitive admin pages (e.g.
 * Pricing) behind a re-auth prompt.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    await verifySensitiveAction(session.user.id, { pin: body.pin, password: body.password });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = err.message ?? "Verification failed.";
    const status =
      message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
