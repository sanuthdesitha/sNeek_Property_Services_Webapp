import { StockTxType } from "@prisma/client";
import { db } from "@/lib/db";
import { getInventoryUnitCosts } from "@/lib/inventory/unit-costs";
import { resolveBranchPropertyIds } from "@/lib/phase3/branches";

export interface StockForecastRow {
  propertyId: string;
  propertyName: string;
  suburb: string;
  itemId: string;
  itemName: string;
  category: string;
  supplier: string;
  unit: string;
  onHand: number;
  parLevel: number;
  reorderThreshold: number;
  usageLookbackUnits: number;
  avgDailyUsage: number;
  daysUntilReorder: number | null;
  suggestedOrderQty: number;
  unitCost: number | null;
  estimatedOrderCost: number | null;
  risk: "LOW_STOCK" | "RISK_7D" | "RISK_14D" | "OK";
}

export interface SupplierOrderSuggestion {
  supplier: string;
  lines: number;
  estimatedTotalCost: number;
  items: Array<{
    propertyId: string;
    propertyName: string;
    suburb: string;
    itemId: string;
    itemName: string;
    unit: string;
    qty: number;
    estimatedCost: number | null;
    risk: StockForecastRow["risk"];
  }>;
}

export interface StockForecastResult {
  lookbackDays: number;
  generatedAt: string;
  rows: StockForecastRow[];
  bySupplier: SupplierOrderSuggestion[];
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export async function getStockForecast(input?: {
  lookbackDays?: number;
  branchId?: string | null;
}) {
  const lookbackDays = clampInt(Number(input?.lookbackDays ?? 30), 7, 180);
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const branchPropertyIds = await resolveBranchPropertyIds(input?.branchId);
  if (Array.isArray(branchPropertyIds) && branchPropertyIds.length === 0) {
    return {
      lookbackDays,
      generatedAt: new Date().toISOString(),
      rows: [],
      bySupplier: [],
    } satisfies StockForecastResult;
  }

  const [stocks, usage, unitCosts] = await Promise.all([
    db.propertyStock.findMany({
      where:
        Array.isArray(branchPropertyIds) && branchPropertyIds.length > 0
          ? { propertyId: { in: branchPropertyIds } }
          : undefined,
      include: {
        item: {
          select: {
            id: true,
            name: true,
            category: true,
            supplier: true,
            unit: true,
            isActive: true,
          },
        },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
      },
      orderBy: [{ property: { name: "asc" } }, { item: { name: "asc" } }],
    }),
    db.stockTx.groupBy({
      by: ["propertyStockId"],
      where: {
        txType: StockTxType.USED,
        createdAt: { gte: since },
      },
      _sum: { quantity: true },
    }),
    getInventoryUnitCosts(),
  ]);

  const usageByStockId = new Map<string, number>();
  for (const row of usage) {
    usageByStockId.set(row.propertyStockId, Math.abs(Number(row._sum.quantity ?? 0)));
  }

  const rows: StockForecastRow[] = stocks
    .filter((stock) => stock.item.isActive)
    .map((stock) => {
      const usageLookbackUnits = usageByStockId.get(stock.id) ?? 0;
      const avgDailyUsage = usageLookbackUnits > 0 ? usageLookbackUnits / lookbackDays : 0;
      const daysUntilReorder =
        avgDailyUsage > 0 ? (stock.onHand - stock.reorderThreshold) / avgDailyUsage : null;
      const suggestedOrderQty = Math.max(0, stock.parLevel - stock.onHand);
      const unitCost = unitCosts[stock.item.id] ?? null;
      const estimatedOrderCost =
        unitCost != null ? Number((suggestedOrderQty * unitCost).toFixed(2)) : null;
      let risk: StockForecastRow["risk"] = "OK";
      if (stock.onHand <= stock.reorderThreshold) {
        risk = "LOW_STOCK";
      } else if (daysUntilReorder != null && daysUntilReorder <= 7) {
        risk = "RISK_7D";
      } else if (daysUntilReorder != null && daysUntilReorder <= 14) {
        risk = "RISK_14D";
      }
      return {
        propertyId: stock.property.id,
        propertyName: stock.property.name,
        suburb: stock.property.suburb,
        itemId: stock.item.id,
        itemName: stock.item.name,
        category: stock.item.category,
        supplier: stock.item.supplier ?? "Unknown",
        unit: stock.item.unit,
        onHand: Number(stock.onHand),
        parLevel: Number(stock.parLevel),
        reorderThreshold: Number(stock.reorderThreshold),
        usageLookbackUnits: Number(usageLookbackUnits.toFixed(2)),
        avgDailyUsage: Number(avgDailyUsage.toFixed(3)),
        daysUntilReorder:
          daysUntilReorder == null ? null : Number(daysUntilReorder.toFixed(1)),
        suggestedOrderQty: Number(suggestedOrderQty.toFixed(2)),
        unitCost: unitCost == null ? null : Number(unitCost.toFixed(2)),
        estimatedOrderCost,
        risk,
      };
    })
    .sort((a, b) => {
      const riskRank = (risk: StockForecastRow["risk"]) =>
        risk === "LOW_STOCK" ? 0 : risk === "RISK_7D" ? 1 : risk === "RISK_14D" ? 2 : 3;
      const rankDiff = riskRank(a.risk) - riskRank(b.risk);
      if (rankDiff !== 0) return rankDiff;
      if (a.supplier !== b.supplier) return a.supplier.localeCompare(b.supplier);
      if (a.propertyName !== b.propertyName) return a.propertyName.localeCompare(b.propertyName);
      return a.itemName.localeCompare(b.itemName);
    });

  const bySupplierMap = new Map<string, SupplierOrderSuggestion>();
  for (const row of rows) {
    if (row.suggestedOrderQty <= 0 && row.risk === "OK") continue;
    if (!bySupplierMap.has(row.supplier)) {
      bySupplierMap.set(row.supplier, {
        supplier: row.supplier,
        lines: 0,
        estimatedTotalCost: 0,
        items: [],
      });
    }
    const group = bySupplierMap.get(row.supplier)!;
    group.lines += 1;
    if (row.estimatedOrderCost != null) {
      group.estimatedTotalCost += row.estimatedOrderCost;
    }
    group.items.push({
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      suburb: row.suburb,
      itemId: row.itemId,
      itemName: row.itemName,
      unit: row.unit,
      qty: row.suggestedOrderQty,
      estimatedCost: row.estimatedOrderCost,
      risk: row.risk,
    });
  }

  const bySupplier = Array.from(bySupplierMap.values()).sort((a, b) =>
    a.supplier.localeCompare(b.supplier)
  );

  return {
    lookbackDays,
    generatedAt: new Date().toISOString(),
    rows,
    bySupplier,
  } satisfies StockForecastResult;
}

