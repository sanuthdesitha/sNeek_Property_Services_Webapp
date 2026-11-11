import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadLiveBoard } from "@/lib/ops/live-board";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Today's Live ops board: classified jobs (late, off site with the clock
 * running, not started, on site, travelling), pending continuation requests
 * and active laundry routes. Same roles as the Live ops page.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  try {
    const settings = await getAppSettings().catch(() => null);
    const board = await loadLiveBoard({ timeZone: settings?.timezone || "Australia/Sydney" });
    return NextResponse.json(board, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The live board could not be loaded." }, { status: 500 });
  }
}
