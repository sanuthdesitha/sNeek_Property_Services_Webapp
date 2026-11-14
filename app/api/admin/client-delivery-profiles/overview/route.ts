import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { buildDeliveryOverview } from "@/lib/commercial/delivery-overview";

export const dynamic = "force-dynamic";

/**
 * Delivery profiles screen (2026-11-16): one row per active client with its
 * lists, the fallback the send paths add, bounce marks and the last send.
 * ADMIN and OPS_MANAGER (communications pack, middleware); live role guard.
 */
export async function GET() {
  let session;
  try {
    session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  try {
    return NextResponse.json(await buildDeliveryOverview(session), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Delivery profiles could not be loaded." }, { status: 500 });
  }
}
