import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { parseListQuery } from "@/lib/admin/list-query";
import { parseQualityFiltersStrict } from "@/lib/quality/filters";
import { hubErrorResponse } from "@/lib/quality/http";
import { inspectionQueueCounters, listOpenInspections, type InspectionQueueResponse } from "@/lib/quality/inspections";
import { INSPECTION_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/**
 * Review queue: open inspections, paged with a real total (no 12-row cap), with
 * the old page's Awaiting QA / In progress / Completed today counters.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: INSPECTION_SORTS, defaultSort: "due", defaultDir: "asc" });
    const filters = parseQualityFiltersStrict(params);
    const [list, counters] = await Promise.all([listOpenInspections(filters, query), inspectionQueueCounters(filters)]);
    const body: InspectionQueueResponse = { ...list, counters };
    return NextResponse.json(body);
  } catch (error) {
    return hubErrorResponse(error, "Could not load the inspection queue.");
  }
}
