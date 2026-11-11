import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { hubErrorResponse, periodPayload, readHubQuery } from "@/lib/quality/http";
import { getQualitySummary } from "@/lib/quality/summary";

export const dynamic = "force-dynamic";

/** Quality hub stat cards and tab counts for one period and filter set. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const now = new Date();
    const { period, filters } = readHubQuery(req.nextUrl.searchParams, now);
    const summary = await getQualitySummary(period, filters, now);
    return NextResponse.json({ period: periodPayload(period), generatedAt: now.toISOString(), ...summary });
  } catch (error) {
    return hubErrorResponse(error, "Could not load the quality summary.");
  }
}
