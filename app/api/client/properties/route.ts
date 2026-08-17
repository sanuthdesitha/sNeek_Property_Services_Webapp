import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { listClientPropertiesForUser } from "@/lib/client/portal-data";

export async function GET() {
  try {
    // One chokepoint replaces the role check, the client lookup and the portal
    // context. A VA additionally needs the `properties` grant, and the list is
    // narrowed to their team's property scope inside the data layer.
    const portal = await requireClientPortal({ permission: "properties" });
    if (!isClientModuleEnabled(portal.visibility, "properties")) {
      return NextResponse.json({ error: "Properties are hidden for this client." }, { status: 403 });
    }
    const properties = await listClientPropertiesForUser(portal.userId);
    return NextResponse.json(properties);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load properties." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
