import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AccountEmailError, copyInvitationLink, resolveAccountEmailActor } from "@/lib/accounts/account-emails";

const headers = { "Cache-Control": "private, no-store" };

/**
 * POST /api/admin/users/[id]/account-emails/invitation-link — the pending
 * invitation link, to share another way (it is not re-issued, so the emailed
 * link keeps working). Same senders as the resend; audited. Password reset
 * links and codes are never shown.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await resolveAccountEmailActor(session);
    return NextResponse.json(await copyInvitationLink(actor, params.id), { headers });
  } catch (error) {
    if (error instanceof AccountEmailError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not read the invitation link." : message }, { status, headers });
  }
}
