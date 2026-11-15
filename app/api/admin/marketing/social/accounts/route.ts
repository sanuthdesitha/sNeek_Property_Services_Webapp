import { NextRequest, NextResponse } from "next/server";
import { listAccounts, metaAppState, metaRedirectUri } from "@/lib/marketing/social/accounts";
import { publicMediaBase } from "@/lib/marketing/social/public-media";
import { requireSocialSession, socialErrorResponse, socialHttp } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

/** Connected accounts and the Meta app state. Never a token or the App Secret. */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSocialSession();
    const base = publicMediaBase();
    const origin = "base" in base ? base.base : req.nextUrl.origin;
    return NextResponse.json({
      accounts: await listAccounts(),
      metaApp: await metaAppState(),
      redirectUri: metaRedirectUri(origin),
      publicAddress: "base" in base ? { ok: true, base: base.base } : { ok: false, problem: base.problem },
      encryptionKeySet: Boolean(process.env.ENCRYPTION_KEY?.trim()),
      canConnect: session.user.role === "ADMIN" && !session.impersonation,
      stubbed: socialHttp().stubbed,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return socialErrorResponse(error);
  }
}
