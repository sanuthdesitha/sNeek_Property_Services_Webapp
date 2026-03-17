import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listSupplierCatalog } from "@/lib/inventory/suppliers";
import { getStockForecast } from "@/lib/phase3/stock-forecast";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const lookbackDays = Number(searchParams.get("lookbackDays") ?? 30);
    const branchId = searchParams.get("branchId")?.trim() || null;
    const [forecast, suppliers] = await Promise.all([
      getStockForecast({ lookbackDays, branchId }),
      listSupplierCatalog(),
    ]);
    const supplierByName = new Map(
      suppliers.map((supplier) => [supplier.name.toLowerCase(), supplier] as const)
    );
    const bySupplier = forecast.bySupplier.map((group) => ({
      ...group,
      supplierProfile: supplierByName.get(group.supplier.toLowerCase()) ?? null,
    }));
    return NextResponse.json({
      lookbackDays: forecast.lookbackDays,
      generatedAt: forecast.generatedAt,
      branchId,
      bySupplier,
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not build supplier suggestions." }, { status });
  }
}

