import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { resolveAllSegmentCounts } from "@/lib/marketing/segments";

export const dynamic = "force-dynamic";

/**
 * Named marketing audiences with a LIVE recipient count, so the campaign editor
 * can show "1,204 recipients" before anyone clicks send.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const segments = await resolveAllSegmentCounts(new Date());
    return NextResponse.json({ segments });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not resolve segments." }, { status });
  }
}
