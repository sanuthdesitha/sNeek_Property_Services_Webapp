import { NextRequest, NextResponse } from "next/server";
import { requireInsightsAccess } from "@/lib/insights/access";
import { getCleanerInsights } from "@/lib/insights/entity-service";
import { insightsErrorResponse, readInsightsQuery } from "@/lib/insights/http";

export const dynamic = "force-dynamic";

/** Insights Cleaners tab: cleans, hours, QA score, issues and rework per cleaner. */
export async function GET(req: NextRequest) {
  try {
    const access = await requireInsightsAccess();
    const params = req.nextUrl.searchParams;
    const { period, filters } = readInsightsQuery(params);
    return NextResponse.json(await getCleanerInsights(period, filters, access, params));
  } catch (error) {
    return insightsErrorResponse(error, "Could not load the cleaner figures.");
  }
}
