import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { completeMetaConnect, metaRedirectUri, SocialAccountError } from "@/lib/marketing/social/accounts";
import { publicMediaBase } from "@/lib/marketing/social/public-media";
import { socialHttp } from "@/lib/marketing/social/route-helpers";

export const dynamic = "force-dynamic";

const PAGE = "/v2/admin/marketing/social-accounts";

function back(req: NextRequest, params: Record<string, string>) {
  const url = new URL(PAGE, req.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value.slice(0, 300));
  return NextResponse.redirect(url);
}

/**
 * Facebook sends the administrator back here after its sign-in page. The
 * state must be the one this administrator started within 10 minutes; it is
 * used once. Tokens never reach the browser or the address bar.
 */
export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireRole([Role.ADMIN]);
  } catch {
    return back(req, { connect: "failed", reason: "Sign in as an administrator and press Connect again." });
  }
  if (session.impersonation) return back(req, { connect: "failed", reason: "Stop testing as someone else, then connect again." });
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back(req, { connect: "failed", reason: "Facebook sign-in was cancelled or refused. Nothing was connected." });
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || code.length > 2000 || state.length > 200) return back(req, { connect: "failed", reason: "Facebook did not return a sign-in. Press Connect again." });
  try {
    const base = publicMediaBase();
    const result = await completeMetaConnect({ actorId: session.user.id, state, code, redirectUri: metaRedirectUri("base" in base ? base.base : req.nextUrl.origin), http: socialHttp().http });
    return back(req, { connect: "ok", ...(result.note ? { note: result.note } : {}) });
  } catch (error) {
    return back(req, { connect: "failed", reason: error instanceof SocialAccountError ? error.message : "The connection could not be completed. Nothing was connected." });
  }
}
