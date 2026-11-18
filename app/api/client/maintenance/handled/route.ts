/**
 * GET /api/client/maintenance/handled → { items }
 *
 * Maintenance items the office handed to this client to arrange (client-
 * handled maintenance, 2026-11-18): current ones first, then the record of
 * earlier ones. Guard: the client-portal chokepoint with the maintenance
 * permission; the client and property scope are re-read from the database on
 * every request, so an assistant narrowed to some properties sees only those.
 * The payload carries no cost, access detail, worker instruction or office note.
 */
import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { listClientHandledItems } from "@/lib/maintenance/client-handling";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const portal = await requireClientPortal({ permission: "maintenance" });
    const items = await listClientHandledItems(portal);
    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the items for you to arrange." : "You do not have access to this." }, { status });
  }
}
