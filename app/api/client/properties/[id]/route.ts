import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { getClientPropertyDetailForUser } from "@/lib/client/portal-data";
import { isClientModuleEnabled } from "@/lib/portal-access";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const portal = await requireClientPortal({ permission: "properties" });
    if (!isClientModuleEnabled(portal.visibility, "properties")) {
      return NextResponse.json({ error: "Properties are hidden for this client." }, { status: 403 });
    }
    // The requested id is ANDed with the caller's property scope in the data
    // layer, so a scoped VA reaching for a property outside their grant gets
    // the same 404 as one that does not exist — no existence oracle.
    const detail = await getClientPropertyDetailForUser(portal.userId, params.id, portal.visibility);
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
