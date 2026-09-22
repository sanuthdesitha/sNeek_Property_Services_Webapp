import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { getClientPurchases } from "@/lib/inventory/client-purchases";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function GET() {
  try {
    // Shopping has no delegated VA permission. Retain the existing client-only policy.
    await requireRole([Role.CLIENT]);
    const portal = await requireClientPortal();
    if (portal.actor !== "CLIENT" || !isClientModuleEnabled({ ...portal.settings, clientPortalVisibility: portal.visibility }, "shopping")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
    return NextResponse.json(await getClientPurchases(portal.clientId), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 503;
    return NextResponse.json({ error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Purchases could not be loaded. Try again." }, { status, headers });
  }
}
