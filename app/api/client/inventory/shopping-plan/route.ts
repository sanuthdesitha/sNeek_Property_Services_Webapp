import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getShoppingListRows } from "@/lib/inventory/shopping-list-report";
import { getInventoryUnitCosts } from "@/lib/inventory/unit-costs";
import { isClientModuleEnabled } from "@/lib/portal-access";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const appSettings = await getAppSettings();
    if (!isClientModuleEnabled(appSettings, "shopping")) {
      return NextResponse.json({ error: "Shopping is not available for client users." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const propertyId = (searchParams.get("propertyId") ?? "").trim();

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        clientId: true,
        client: {
          select: {
            id: true,
            properties: {
              where: { isActive: true },
              select: { id: true, name: true, suburb: true },
              orderBy: { name: "asc" },
            },
          },
        },
      },
    });

    const allowedProperties = user?.client?.properties ?? [];
    const allowedPropertyIds = new Set(allowedProperties.map((property) => property.id));
    const scopedPropertyIds =
      propertyId && allowedPropertyIds.has(propertyId)
        ? [propertyId]
        : propertyId
          ? []
          : allowedProperties.map((property) => property.id);

    if (propertyId && scopedPropertyIds.length === 0) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const [rawRows, unitCosts] = await Promise.all([
      scopedPropertyIds.length > 0 ? getShoppingListRows({ propertyIds: scopedPropertyIds }) : Promise.resolve([]),
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
      scope: "client",
      rows,
      properties: allowedProperties,
      propertySummaries: Object.values(summaryByProperty).sort((a, b) => a.propertyName.localeCompare(b.propertyName)),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}
