import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { metaAppState, saveMetaApp } from "@/lib/marketing/social/accounts";
import { socialErrorResponse } from "@/lib/marketing/social/route-helpers";

const schema = z.object({ appId: z.string().max(40), appSecret: z.string().max(200).optional().nullable(), security: z.unknown().optional() }).strict();

/** Saves the Meta App ID and (when given) a new App Secret, stored encrypted. ADMIN only, own PIN. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter the App ID (and the App Secret to replace it)." }, { status: 400 });
    const refusal = await routeSecurityRefusal(session, securityFromBody(body) ?? null, "social.connect");
    if (refusal) return refusal;
    await saveMetaApp({ appId: parsed.data.appId, appSecret: parsed.data.appSecret ?? null, actorId: session.user.id });
    return NextResponse.json({ metaApp: await metaAppState() });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
