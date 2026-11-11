import { NextRequest, NextResponse } from "next/server";
import { requireInsightsAccess } from "@/lib/insights/access";
import { getPropertyInsights } from "@/lib/insights/entity-service";
import { insightsErrorResponse, readInsightsQuery } from "@/lib/insights/http";

export const dynamic = "force-dynamic";

/** Insights Properties tab: one sortable, paged row per property with cleans in the period. */
export async function GET(req: NextRequest) {
  try {
    const access = await requireInsightsAccess();
    const params = req.nextUrl.searchParams;
    const { period, filters } = readInsightsQuery(params);
    return NextResponse.json(await getPropertyInsights(period, filters, access, params));
  } catch (error) {
    return insightsErrorResponse(error, "Could not load the property figures.");
  }
}
