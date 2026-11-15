import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { revokeConsent } from "@/lib/marketing/social/consent";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

const schema = z.object({ reason: z.string().max(500).optional().nullable() }).strict();

/**
 * Revokes a client's permission (tier B): unposted drafts of those properties
 * are deleted with their copies; posted posts are flagged for a person to
 * remove on each network. History keeps the old yes and this revocation.
 */
export async function POST(req: NextRequest, { params }: { params: { clientId: string } }) {
  try {
    const session = await requireSocialRight("consent");
    if (session.impersonation) return NextResponse.json({ error: "Stop testing as someone else to revoke a permission." }, { status: 403 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const cascade = await revokeConsent(params.clientId, { userId: session.user.id, via: "OFFICE" }, parsed.data.reason ?? null);
    return NextResponse.json({ cascade });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
