import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getXeroAuthUrl } from "@/lib/xero/client";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
    const redirectUri = `${baseUrl}/api/xero/callback`;
    const state = `admin-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const authUrl = await getXeroAuthUrl(redirectUri, state);
    console.log("[xero] Auth URL:", authUrl);
    console.log("[xero] Redirect URI:", redirectUri);

    return NextResponse.json({ authUrl });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not start Xero auth." }, { status });
  }
}
