import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { readQueryValue } from "@/lib/admin/list-query";
import { getLaundryTeamMetrics } from "@/lib/laundry/team-metrics";
import { hubErrorResponse, periodPayload } from "@/lib/quality/http";
import { QualityQueryError, resolveQualityPeriod } from "@/lib/quality/period";

export const dynamic = "force-dynamic";

/**
 * Laundry team and supplier metrics for the Quality hub (parity audit
 * 2026-11-12). The same service and response as GET
 * /api/admin/laundry/team-metrics, but under /api/admin/quality, so the ops
 * catalog gates it by the QUALITY pack: an operations manager with quality
 * but not laundry keeps the "Our laundry team" figures the old accountability
 * page showed them. The catalog maps a path to one pack, so a second read
 * route is how "either pack" is expressed. Read only; nothing is written.
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
