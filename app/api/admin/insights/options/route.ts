import { NextResponse } from "next/server";
import { requireInsightsAccess } from "@/lib/insights/access";
import { insightsErrorResponse } from "@/lib/insights/http";
import { loadClientOptions } from "@/lib/insights/load-facts";

export const dynamic = "force-dynamic";

/** The client filter's choices, plus which figure groups this viewer receives. */
export async function GET() {
  try {
    const access = await requireInsightsAccess();
    return NextResponse.json({ access, clients: await loadClientOptions() });
  } catch (error) {
    return insightsErrorResponse(error, "Could not load the Insights options.");
  }
}
