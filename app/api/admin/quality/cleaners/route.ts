import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getCleanerRows } from "@/lib/quality/cleaners";
import { hubErrorResponse, periodPayload, readHubQuery, readSort } from "@/lib/quality/http";
import { CLEANER_SORTS } from "@/lib/quality/types";

export const dynamic = "force-dynamic";

/** Quality hub Cleaners tab: per-cleaner accountability over the period and filters. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const now = new Date();
    const params = req.nextUrl.searchParams;
    const { period, filters } = readHubQuery(params, now);
    const { sort, dir } = readSort(params, CLEANER_SORTS, "score");
    const result = await getCleanerRows(period, filters, sort, dir, now);
    return NextResponse.json({ period: periodPayload(period), ...result });
  } catch (error) {
    return hubErrorResponse(error, "Could not load cleaner accountability.");
  }
}
