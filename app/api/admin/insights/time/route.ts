import { NextRequest, NextResponse } from "next/server";
import { requireInsightsAccess } from "@/lib/insights/access";
import { getTimeCostInsights } from "@/lib/insights/entity-service";
import { insightsErrorResponse, readInsightsQuery } from "@/lib/insights/http";

export const dynamic = "force-dynamic";

/** Insights Time and cost tab: planned against actual hours by job type and property; cleaner cost by week. */
export async function GET(req: NextRequest) {
  try {
    const access = await requireInsightsAccess();
    const { period, filters } = readInsightsQuery(req.nextUrl.searchParams);
    return NextResponse.json(await getTimeCostInsights(period, filters, access));
  } catch (error) {
    return insightsErrorResponse(error, "Could not load the time and cost figures.");
  }
}
