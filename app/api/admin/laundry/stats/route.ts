import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { loadLaundryStats } from "@/lib/laundry/stats-load";

export const dynamic = "force-dynamic";

/** GET /api/admin/laundry/stats — the Statistics tab's figures (loaded when the tab opens). */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await loadLaundryStats());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not load laundry statistics.";
    return NextResponse.json({ error: message }, { status: getApiErrorStatus(err) });
  }
}
