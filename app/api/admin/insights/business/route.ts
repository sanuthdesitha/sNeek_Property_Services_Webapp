import { NextRequest, NextResponse } from "next/server";
import { requireInsightsAccess } from "@/lib/insights/access";
import { getBusinessInsights } from "@/lib/insights/business";
import { insightsErrorResponse, readInsightsQuery } from "@/lib/insights/http";

export const dynamic = "force-dynamic";

/** Insights Business tab: findings, figure cards, weekly money and the property preview. */
export async function GET(req: NextRequest) {
  try {
    const access = await requireInsightsAccess();
    const now = new Date();
    const { period, filters } = readInsightsQuery(req.nextUrl.searchParams, now);
    return NextResponse.json(await getBusinessInsights(period, filters, access, now));
  } catch (error) {
    return insightsErrorResponse(error, "Could not load the business figures.");
  }
}
