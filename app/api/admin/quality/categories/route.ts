import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getCategoryRows } from "@/lib/quality/categories";
import { hubErrorResponse, periodPayload, readHubQuery, readSort } from "@/lib/quality/http";
import { CATEGORY_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/** Quality hub Categories tab: issues by category with the cleaners behind them. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const { period, filters } = readHubQuery(params);
    const { sort, dir } = readSort(params, CATEGORY_SORTS, "issues");
    const result = await getCategoryRows(period, filters, sort, dir);
    return NextResponse.json({ period: periodPayload(period), ...result });
  } catch (error) {
    return hubErrorResponse(error, "Could not load issue categories.");
  }
}
