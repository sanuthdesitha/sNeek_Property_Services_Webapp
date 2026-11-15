import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { metaRedirectUri, startMetaConnect } from "@/lib/marketing/social/accounts";
import { publicMediaBase } from "@/lib/marketing/social/public-media";
import { socialErrorResponse } from "@/lib/marketing/social/route-helpers";

/**
 * Starts "Connect Facebook and Instagram" (tier C: ADMIN, own PIN, never
 * while testing as someone). Answers Facebook's own sign-in address; the
 * person signs in there and chooses what to share.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => null);
    const refusal = await routeSecurityRefusal(session, securityFromBody(body) ?? null, "social.connect");
    if (refusal) return refusal;
    const base = publicMediaBase();
    const { authUrl } = await startMetaConnect({ actorId: session.user.id, redirectUri: metaRedirectUri("base" in base ? base.base : req.nextUrl.origin) });
    return NextResponse.json({ authUrl });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
