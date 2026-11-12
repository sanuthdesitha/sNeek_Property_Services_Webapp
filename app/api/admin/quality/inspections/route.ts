import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { parseListQuery } from "@/lib/admin/list-query";
import { parseQualityFiltersStrict } from "@/lib/quality/filters";
import { hubErrorResponse } from "@/lib/quality/http";
import { listOpenInspections } from "@/lib/quality/inspections";
import { INSPECTION_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/** Review queue: open inspections, paged with a real total (no 12-row cap). */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, { sortable: INSPECTION_SORTS, defaultSort: "due", defaultDir: "asc" });
    return NextResponse.json(await listOpenInspections(parseQualityFiltersStrict(params), query));
  } catch (error) {
    return hubErrorResponse(error, "Could not load the inspection queue.");
  }
}
