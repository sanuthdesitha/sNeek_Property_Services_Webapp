import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { hubErrorResponse, periodPayload, readHubQuery, readSort } from "@/lib/quality/http";
import { getInspectorRows } from "@/lib/quality/inspectors";
import { INSPECTOR_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/** Quality hub Inspectors tab: QA performance per inspector over the period and filters. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const { period, filters } = readHubQuery(params);
    const { sort, dir } = readSort(params, INSPECTOR_SORTS, "issues");
    const result = await getInspectorRows(period, filters, sort, dir);
    return NextResponse.json({ period: periodPayload(period), ...result });
  } catch (error) {
    return hubErrorResponse(error, "Could not load inspector performance.");
  }
}
