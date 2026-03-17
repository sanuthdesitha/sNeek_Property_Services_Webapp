import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getStockForecast } from "@/lib/phase3/stock-forecast";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const lookbackDays = Number(searchParams.get("lookbackDays") ?? 30);
    const branchId = searchParams.get("branchId")?.trim() || null;
    const forecast = await getStockForecast({ lookbackDays, branchId });
    return NextResponse.json(forecast);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not compute stock forecast." }, { status });
  }
}

