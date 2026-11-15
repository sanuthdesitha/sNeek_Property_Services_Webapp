import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { isMatch } from "date-fns";
import { requireRole } from "@/lib/auth/session";
import { loadRouteMapDay } from "@/lib/ops/route-map-day";

export const dynamic = "force-dynamic";

/**
 * The route map's day: routes, jobs with nobody on them (with the existing
 * scorer's read-only suggestion) and the active cleaners for the assign
 * dialog. ADMIN and OPS_MANAGER as the page always allowed; an operations
 * manager also needs the Jobs pack (enforced for every /api/admin/jobs path).
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!isMatch(date, "yyyy-MM-dd")) return NextResponse.json({ error: "Choose a date." }, { status: 400 });
    return NextResponse.json(await loadRouteMapDay(date), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: "You cannot open the route map." }, { status: 403 });
    return NextResponse.json({ error: "The routes could not be worked out." }, { status: 500 });
  }
}
