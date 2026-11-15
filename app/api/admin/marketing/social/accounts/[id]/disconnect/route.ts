import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { disconnectAccount, listAccounts } from "@/lib/marketing/social/accounts";
import { socialErrorResponse, socialHttp } from "@/lib/marketing/social/route-helpers";

/** Disconnect (tier C: ADMIN, own PIN, never while testing as someone). Posts already made stay on the network. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => null);
    const refusal = await routeSecurityRefusal(session, securityFromBody(body) ?? null, "social.connect");
    if (refusal) return refusal;
    const result = await disconnectAccount({ accountId: params.id, actorId: session.user.id, http: socialHttp().http });
    return NextResponse.json({ ...result, accounts: await listAccounts() });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
