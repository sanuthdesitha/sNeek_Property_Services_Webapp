import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

/**
 * After a failed credential login, the login page calls this to turn the
 * generic "Invalid email or password" into an actionable reason — the common
 * real cause for "a staff member can't log in" is an invited account that
 * never set a password, an inactive account, or maintenance-mode lockout.
 *
 * Returns only a coarse reason code (no password hashes, names, or roles
 * beyond a maintenance flag) so it stays safe for an internal ops tool.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return NextResponse.json({ reason: "unknown" });

    const settings = await getAppSettings();
    const mm = settings.websiteContent.maintenanceMode;

    const user = await db.user.findUnique({
      where: { email },
      select: { isActive: true, passwordHash: true, role: true },
    });

    // No such account / correct-but-wrong-password → stay generic.
    if (!user) return NextResponse.json({ reason: "unknown" });

    // Maintenance lockout only affects non-admin/ops roles.
    if (
      mm?.enabled === true &&
      mm?.allowLogin === false &&
      user.role !== Role.ADMIN &&
      user.role !== Role.OPS_MANAGER
    ) {
      return NextResponse.json({ reason: "maintenance" });
    }

    if (!user.isActive) return NextResponse.json({ reason: "inactive" });
    if (!user.passwordHash) return NextResponse.json({ reason: "no-password" });

    return NextResponse.json({ reason: "unknown" });
  } catch {
    return NextResponse.json({ reason: "unknown" });
  }
}
