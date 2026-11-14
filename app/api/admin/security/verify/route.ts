import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { SensitiveVerificationError, verifySensitiveAction } from "@/lib/security/admin-verification";

/**
 * Verify-only endpoint: confirms the caller's OWN PIN without performing any
 * mutation. Used to gate/unlock sensitive admin pages (Rate card, Price book)
 * and by a few prompts owned by other screens that check before acting (every
 * tier C route in the confirmations board verifies `security` itself since
 * 2026-11-14). While the caller has no PIN yet their account password alone
 * confirms (owner default 2026-11-14); a `newPin` sent with it is stored as
 * their PIN. Refused while testing as someone else. Answers
 * `{ ok: false, error, code }`; `code` is one of SensitiveVerificationCode.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = (await req.json().catch(() => ({}))) as { pin?: unknown; password?: unknown; newPin?: unknown };
    await verifySensitiveAction(session.user.id, {
      pin: typeof body.pin === "string" ? body.pin : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
      newPin: typeof body.newPin === "string" ? body.newPin : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = err instanceof SensitiveVerificationError ? err.code : err instanceof Error ? err.message : "INVALID_SECURITY_VERIFICATION";
    const message = err instanceof Error ? err.message : "Verification failed.";
    const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" || code === "ACTUAL_ACTOR_REQUIRED" ? 403 : code === "PIN_LOCKED" ? 429 : 400;
    return NextResponse.json({ ok: false, error: message, code }, { status });
  }
}
