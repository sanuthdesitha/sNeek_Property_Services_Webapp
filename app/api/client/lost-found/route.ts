/**
 * GET /api/client/lost-found → { items, clientsCanApprove, timeZone }
 *
 * Lost items found at the caller's own properties and the guests' return
 * requests (2026-11-20). Guard: the client-portal chokepoint with the
 * properties permission; the client and property scope are read from the
 * database on every request, so an assistant narrowed to some properties sees
 * only those. No internal notes, storage, value, cleaner names, guest contact
 * or address.
 */
import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { listClientLostFound } from "@/lib/lost-found/return-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const portal = await requireClientPortal({ permission: "properties" });
    return NextResponse.json(await listClientLostFound(portal), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load lost and found." : "You do not have access to this." }, { status });
  }
}
