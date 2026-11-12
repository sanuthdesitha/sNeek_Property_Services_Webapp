import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { AccountEmailError, resolveAccountEmailActor } from "@/lib/accounts/account-emails";
import { INVITATION_REVOKE_BULK_MAX, revokeInvitations } from "@/lib/accounts/invitation-revoke";

const headers = { "Cache-Control": "private, no-store" };
const bodySchema = z.object({ userIds: z.array(z.string().trim().min(1).max(128)).min(1).max(INVITATION_REVOKE_BULK_MAX) }).strict();

/**
 * POST /api/admin/users/account-emails/revoke { userIds } — People ›
 * Invitations bulk "Revoke" (owner decision 2026-11-13). Each person goes
 * through the single revoke's rules; the answer lists every row as revoked or
 * refused with its reason.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await resolveAccountEmailActor(session);
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: `Choose between 1 and ${INVITATION_REVOKE_BULK_MAX} people.` }, { status: 400, headers });
    const results = await revokeInvitations(actor, parsed.data.userIds);
    return NextResponse.json({ results, revoked: results.filter((row) => row.outcome === "revoked").length }, { headers });
  } catch (error) {
    if (error instanceof AccountEmailError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not revoke the invitations." : message }, { status, headers });
  }
}
