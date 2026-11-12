import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SensitiveVerificationError, verifySensitiveAction } from "@/lib/security/admin-verification";
import { resetPersonPin } from "@/lib/security/own-pin";

/**
 * POST /api/admin/users/[id]/reset-pin { security }
 *
 * An administrator clears another person's sensitive-action PIN so that person
 * must set a new one at their next sensitive action (or in their profile). The
 * administrator never sees or chooses the PIN. Administrator only (live guard;
 * never delegated, and an impersonated session is never an administrator),
 * confirmed with the administrator's OWN PIN, not on oneself (use the profile),
 * and audited (`SECURITY_PIN_RESET`) without any PIN.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "Stop testing as someone else first." }, { status: 403 });
    if (params.id === session.user.id) {
      return NextResponse.json({ error: "Change your own PIN in your profile." }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { security?: { pin?: string; password?: string; newPin?: string } };
    await verifySensitiveAction(session.user.id, body.security);

    const target = await db.user.findUnique({
      where: { id: params.id },
      select: { id: true, role: true, extraRoles: { select: { role: true } } },
    });
    if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    const roles = [target.role, ...target.extraRoles.map((row) => row.role)];
    if (!roles.includes(Role.ADMIN) && !roles.includes(Role.OPS_MANAGER)) {
      return NextResponse.json({ error: "Only administrators and operations managers have a PIN." }, { status: 400 });
    }

    const result = await resetPersonPin(session.user.id, target.id);
    return NextResponse.json({ ok: true, hadPin: result.hadPin });
  } catch (err) {
    if (err instanceof SensitiveVerificationError) {
      const status = err.code === "UNAUTHORIZED" ? 401 : err.code === "FORBIDDEN" || err.code === "ACTUAL_ACTOR_REQUIRED" ? 403 : err.code === "PIN_LOCKED" ? 429 : 423;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    const message = err instanceof Error ? err.message : "Could not reset the PIN.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
