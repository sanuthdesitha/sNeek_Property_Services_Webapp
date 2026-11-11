import { NextRequest, NextResponse } from "next/server";
import { requireInsightsAccess } from "@/lib/insights/access";
import { getClientInsights } from "@/lib/insights/entity-service";
import { insightsErrorResponse, readInsightsQuery } from "@/lib/insights/http";

export const dynamic = "force-dynamic";

/** Insights Clients tab: per-client figures, with days to pay and overdue for finance viewers. */
export async function GET(req: NextRequest) {
  try {
    const access = await requireInsightsAccess();
    const now = new Date();
    const params = req.nextUrl.searchParams;
    const { period, filters } = readInsightsQuery(params, now);
    return NextResponse.json(await getClientInsights(period, filters, access, params, now));
  } catch (error) {
    return insightsErrorResponse(error, "Could not load the client figures.");
  }
}
