import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { readQueryValue } from "@/lib/admin/list-query";
import { getLaundryTeamMetrics } from "@/lib/laundry/team-metrics";
import { hubErrorResponse, periodPayload } from "@/lib/quality/http";
import { QualityQueryError, resolveQualityPeriod } from "@/lib/quality/period";

export const dynamic = "force-dynamic";

/**
 * Laundry team and supplier accountability (moved from the accountability
 * overview). ?period=7d|30d|90d, Sydney days, via the shared period helper.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const now = new Date();
    const period = resolveQualityPeriod({ period: readQueryValue(req.nextUrl.searchParams, "period") }, now);
    if (!period.start) throw new QualityQueryError("Laundry metrics need a period with a start.");
    const metrics = await getLaundryTeamMetrics(period.start, now);
    return NextResponse.json({ period: periodPayload(period), generatedAt: now.toISOString(), ...metrics });
  } catch (error) {
    return hubErrorResponse(error, "Could not load laundry team metrics.");
  }
}
