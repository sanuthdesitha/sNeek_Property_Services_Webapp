import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AccountEmailError, resolveAccountEmailActor } from "@/lib/accounts/account-emails";
import { revokeInvitation } from "@/lib/accounts/invitation-revoke";

const headers = { "Cache-Control": "private, no-store" };

/**
 * POST /api/admin/users/[id]/account-emails/revoke-invitation — withdraw this
 * person's pending invitation (owner decision 2026-11-13): the link can no
 * longer be accepted. Same rules as Resend invitation (ADMIN, or OPS_MANAGER
 * with Staff accounts at manage; never upward; never while impersonating);
 * audited. Account and assistant invitations alike.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await resolveAccountEmailActor(session);
    return NextResponse.json(await revokeInvitation(actor, params.id), { headers });
  } catch (error) {
    if (error instanceof AccountEmailError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not revoke the invitation." : message }, { status, headers });
  }
}
