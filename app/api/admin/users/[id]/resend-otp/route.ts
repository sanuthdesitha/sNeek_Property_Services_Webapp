import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resendInvite } from "@/lib/accounts/resend-invite";
import { AccountEmailError, resolveAccountEmailActor } from "@/lib/accounts/account-emails";

/**
 * "Resend invite" for one person (kept at this URL for old screens): a fresh
 * invitation link for a pending invitation, else a fresh sign-up code
 * (lib/accounts/resend-invite.ts). ADMIN, or OPS_MANAGER with Staff accounts
 * at manage; never while impersonating; never to a higher role.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await resolveAccountEmailActor(session);
    const result = await resendInvite(actor, params.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (err: any) {
    if (err instanceof AccountEmailError) return NextResponse.json({ error: err.message }, { status: err.status });
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
