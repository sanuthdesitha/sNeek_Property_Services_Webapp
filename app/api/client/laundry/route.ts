import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { listClientLaundryForUser } from "@/lib/client/portal-data";

export async function GET() {
  try {
    // Core portal read, so no extra VA grant — the property scope is still
    // applied in the data layer.
    const portal = await requireClientPortal();
    if (!isClientModuleEnabled(portal.visibility, "laundry")) {
      return NextResponse.json({ error: "Laundry updates are hidden for this client." }, { status: 403 });
    }
    const rows = await listClientLaundryForUser(portal.userId);
    return NextResponse.json(rows);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load laundry updates." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
