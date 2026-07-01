import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { exchangeXeroCode } from "@/lib/xero/client";
import { resolveAppBaseUrl } from "@/lib/xero/redirect";

export async function GET(req: NextRequest) {
  // Resolve the real public base URL from proxy/host headers (never the internal
  // 0.0.0.0 bind address) and use it as the base for BOTH the token-exchange
  // redirect URI and every redirect back into the admin UI.
  const appBase = resolveAppBaseUrl(req);
  const back = (query: string) => NextResponse.redirect(new URL(`/admin/integrations/xero?${query}`, appBase));

  try {
    await requireRole([Role.ADMIN]);
  } catch {
    return back("error=unauthorized");
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Xero redirects back here with ?error=... when it rejects the request
  // (e.g. invalid_scope, or access_denied). Surface the real reason.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    const desc = searchParams.get("error_description") || "";
    const response = back(
      `error=${encodeURIComponent(oauthError)}${desc ? `&error_description=${encodeURIComponent(desc)}` : ""}`,
    );
    response.cookies.delete("xero_oauth_state");
    return response;
  }

  if (!code) {
    return back("error=missing_code");
  }

  // CSRF protection: validate the OAuth state against the cookie set at initiation.
  const cookieState = req.cookies.get("xero_oauth_state")?.value;
  const stateValid = !!state && !!cookieState && state === cookieState;

  if (!stateValid) {
    const response = back("error=invalid_state");
    response.cookies.delete("xero_oauth_state");
    return response;
  }

  // Must match the redirect URI used at /connect exactly — derived the same way.
  const redirectUri = `${appBase}/api/xero/callback`;

  let result: { tenantId: string; tenantName: string };
  try {
    result = await exchangeXeroCode(code, redirectUri);
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "Token exchange failed.";
    const response = back(`error=exchange_failed&error_description=${encodeURIComponent(msg)}`);
    response.cookies.delete("xero_oauth_state");
    return response;
  }

  const response = back(`connected=true&tenant=${encodeURIComponent(result.tenantName)}`);
  response.cookies.delete("xero_oauth_state");
  return response;
}
