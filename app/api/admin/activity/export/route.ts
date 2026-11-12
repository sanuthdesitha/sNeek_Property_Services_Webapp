import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError } from "@/lib/admin/list-query";
import { activityCsv, parseActivityFilters } from "@/lib/admin/activity";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/activity/export — the Activity log's current filters as CSV,
 * generated on the server and capped (lib/admin/activity ACTIVITY_CSV_LIMIT).
 * Administrators only, the same as the page.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 401 });
  }
  try {
    const filters = parseActivityFilters(new URL(req.url).searchParams);
    const csv = await activityCsv(filters);
    return new NextResponse(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="activity-log.csv"', "cache-control": "no-store" },
    });
  } catch (error) {
    if (isListQueryError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not export the activity log." }, { status: 500 });
  }
}
