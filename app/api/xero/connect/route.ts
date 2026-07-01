import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getXeroAuthUrl } from "@/lib/xero/client";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);

    // Prefer the configured public URL; otherwise derive from the real request
    // origin. Normalise the dev bind address 0.0.0.0 → localhost (0.0.0.0 is not
    // a valid browser/redirect host). This must EXACTLY match a redirect URI
    // registered on the Xero app, so set NEXT_PUBLIC_APP_URL in production.
    const origin = req.nextUrl.origin.replace("://0.0.0.0", "://localhost");
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || origin).replace(/\/+$/, "");
    const redirectUri = `${baseUrl}/api/xero/callback`;
    const state = randomBytes(16).toString("hex");

    const authUrl = await getXeroAuthUrl(redirectUri, state);
    console.log("[xero] Auth URL:", authUrl);
    console.log("[xero] Redirect URI:", redirectUri);

    const response = NextResponse.json({ authUrl });
    response.cookies.set("xero_oauth_state", state, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not start Xero auth." }, { status });
  }
}
