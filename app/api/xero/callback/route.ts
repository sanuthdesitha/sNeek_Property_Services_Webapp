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

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
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
