import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getShoppingListRows } from "@/lib/inventory/shopping-list-report";
import { getInventoryUnitCosts } from "@/lib/inventory/unit-costs";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.CLEANER) {
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "shopping")) {
        return NextResponse.json({ error: "Shopping is not available for cleaners." }, { status: 403 });
      }
    }
    const { searchParams } = new URL(req.url);
    const propertyId = (searchParams.get("propertyId") ?? "").trim();

    const properties = await db.property.findMany({
      where: { isActive: true, inventoryEnabled: true, ...(propertyId ? { id: propertyId } : {}) },
      select: { id: true, name: true, suburb: true },
      orderBy: { name: "asc" },
    });

    const [rawRows, unitCosts] = await Promise.all([
      properties.length > 0
        ? getShoppingListRows({ propertyIds: properties.map((property) => property.id) })
        : Promise.resolve([]),
      getInventoryUnitCosts(),
    ]);
    const rows = rawRows.map((row) => {
      const estimatedUnitCost = typeof unitCosts[row.item.id] === "number" ? unitCosts[row.item.id] : null;
      return {
        ...row,
        estimatedUnitCost,
        estimatedLineCost: estimatedUnitCost == null ? null : estimatedUnitCost * row.needed,
      };
    });

    const summaryByProperty = rows.reduce<
      Record<string, {
        propertyId: string;
        propertyName: string;
        suburb: string;
        lineCount: number;
        totalNeededUnits: number;
        emergencyCount: number;
        estimatedCost: number;
      }>
    >((acc, row) => {
      const key = row.propertyId;
      if (!acc[key]) {
        acc[key] = {
          propertyId: row.propertyId,
          propertyName: row.propertyName,
          suburb: row.suburb,
          lineCount: 0,
          totalNeededUnits: 0,
          emergencyCount: 0,
          estimatedCost: 0,
        };
      }
      acc[key].lineCount += 1;
      acc[key].totalNeededUnits += row.needed;
      const emergency = row.onHand <= 0 || row.onHand < Math.max(1, row.reorderThreshold);
      if (emergency) acc[key].emergencyCount += 1;
      acc[key].estimatedCost += Number(row.estimatedLineCost ?? 0);
      return acc;
    }, {});

    return NextResponse.json({
      scope: "cleaner",
      rows,
      properties,
      propertySummaries: Object.values(summaryByProperty).sort((a, b) => a.propertyName.localeCompare(b.propertyName)),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}
