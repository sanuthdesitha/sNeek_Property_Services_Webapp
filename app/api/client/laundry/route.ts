import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { listClientLaundryForUser } from "@/lib/client/portal-data";

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!isClientModuleEnabled(portal.visibility, "laundry")) {
      return NextResponse.json({ error: "Laundry updates are hidden for this client." }, { status: 403 });
    }
    const rows = await listClientLaundryForUser(session.user.id);
    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load laundry updates." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
