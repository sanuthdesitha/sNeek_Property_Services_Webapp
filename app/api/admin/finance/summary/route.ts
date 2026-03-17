import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getFinanceSummary } from "@/lib/finance/summary";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get("startDate")?.trim() || undefined;
    const endDate = searchParams.get("endDate")?.trim() || undefined;
    const summary = await getFinanceSummary({ startDate, endDate });
    return NextResponse.json(summary);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}
