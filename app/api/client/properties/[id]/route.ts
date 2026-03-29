import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { isClientModuleEnabled } from "@/lib/portal-access";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!isClientModuleEnabled(portal.visibility, "properties")) {
      return NextResponse.json({ error: "Properties are hidden for this client." }, { status: 403 });
    }
    const detail = await getClientPropertyDetailForUser(session.user.id, params.id, portal.visibility);
    if (!detail) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load property." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
