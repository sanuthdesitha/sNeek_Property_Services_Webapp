import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { exchangeXeroCode } from "@/lib/xero/client";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
  } catch {
    return NextResponse.redirect(new URL("/admin/integrations/xero?error=unauthorized", req.url));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Xero redirects back here with ?error=... when it rejects the request
  // (e.g. invalid_scope when the app's scopes aren't enabled, or access_denied).
  // Surface the real reason instead of reporting a misleading "missing_code".
  const oauthError = searchParams.get("error");
  if (oauthError) {
    const desc = searchParams.get("error_description") || "";
    const response = NextResponse.redirect(
      new URL(
        `/admin/integrations/xero?error=${encodeURIComponent(oauthError)}${desc ? `&error_description=${encodeURIComponent(desc)}` : ""}`,
        req.url,
      ),
    );
    response.cookies.delete("xero_oauth_state");
    return response;
  }

  if (!code) {
    return NextResponse.redirect(new URL("/admin/integrations/xero?error=missing_code", req.url));
  }

  // CSRF protection: validate the OAuth state against the cookie set at initiation.
  const cookieState = req.cookies.get("xero_oauth_state")?.value;
  const stateValid = !!state && !!cookieState && state === cookieState;

  if (!stateValid) {
    const response = NextResponse.redirect(new URL("/admin/integrations/xero?error=invalid_state", req.url));
    response.cookies.delete("xero_oauth_state");
    return response;
  }

  // Must match the redirect URI used at /connect exactly — derive it the same way.
  const origin = req.nextUrl.origin.replace("://0.0.0.0", "://localhost");
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || origin).replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/api/xero/callback`;

  const result = await exchangeXeroCode(code, redirectUri);

  if (!result) {
    const response = NextResponse.redirect(new URL("/admin/integrations/xero?error=exchange_failed", req.url));
    response.cookies.delete("xero_oauth_state");
    return response;
  }

  const response = NextResponse.redirect(new URL(`/admin/integrations/xero?connected=true&tenant=${encodeURIComponent(result.tenantName)}`, req.url));
  response.cookies.delete("xero_oauth_state");
  return response;
}
