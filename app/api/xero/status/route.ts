import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getXeroStatus } from "@/lib/xero/client";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [status, settings] = await Promise.all([getXeroStatus(), getAppSettings().catch(() => null)]);
    // The organisation timezone, so the settings card formats history in it.
    return NextResponse.json({ ...(status ?? { connected: false }), timezone: settings?.timezone ?? "Australia/Sydney" });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not get Xero status." }, { status });
  }
}
