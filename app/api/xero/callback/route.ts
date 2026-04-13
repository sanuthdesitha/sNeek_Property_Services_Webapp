import { NextRequest, NextResponse } from "next/server";
import { exchangeXeroCode } from "@/lib/xero/client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/admin/integrations/xero?error=missing_code", req.url));
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/api/xero/callback`;

  const result = await exchangeXeroCode(code, redirectUri);

  if (!result) {
    return NextResponse.redirect(new URL("/admin/integrations/xero?error=exchange_failed", req.url));
  }

  return NextResponse.redirect(new URL(`/admin/integrations/xero?connected=true&tenant=${encodeURIComponent(result.tenantName)}`, req.url));
}
