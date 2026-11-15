/**
 * One shopping line's cost, as recorded (board "Shopping run", 2026-11-17).
 * PLAIN module: the run service, its PDFs and the run page read the same rule.
 *
 * A bought line with no unit cost and no line cost is "missing": it is left
 * out of the actual total (it always was, as zero) but it is never shown as
 * $0.00. The page and the PDFs say "Not entered" and the totals say how many
 * bought lines are costed. The arithmetic of a costed line is unchanged:
 * the stored line cost, else bought quantity × the stored unit cost.
 */

export type ShoppingLineCostInput = {
  purchased: boolean;
  actualPurchasedQty: number;
  actualUnitCost?: number | null;
  actualLineCost?: number | null;
};

export type ShoppingLineCost =
  | { state: "costed"; unitCost: number | null; lineCost: number }
  | { state: "missing" }
  | { state: "not-bought" };

function stored(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function shoppingLineCost(row: ShoppingLineCostInput): ShoppingLineCost {
  if (!row.purchased) return { state: "not-bought" };
  const lineCost = stored(row.actualLineCost);
  const unitCost = stored(row.actualUnitCost);
  if (lineCost !== null) return { state: "costed", unitCost: unitCost === null ? null : Math.max(0, unitCost), lineCost: Math.max(0, lineCost) };
  if (unitCost !== null) {
    return { state: "costed", unitCost: Math.max(0, unitCost), lineCost: Math.max(0, Number(row.actualPurchasedQty)) * Math.max(0, unitCost) };
  }
  return { state: "missing" };
}

/** The amount a line adds to the actual total: its cost when costed, nothing otherwise. */
export function shoppingLineCostAmount(row: ShoppingLineCostInput): number {
  const cost = shoppingLineCost(row);
  return cost.state === "costed" ? cost.lineCost : 0;
}

export type ShoppingCostCoverage = {
  boughtLines: number;
  costedLines: number;
  /** Bought lines with no cost entered, in run order. */
  missing: Array<{ propertyName: string; itemName: string; quantity: number }>;
};

export function shoppingCostCoverage(
  rows: Array<ShoppingLineCostInput & { propertyName: string; itemName: string }>,
): ShoppingCostCoverage {
  const bought = rows.filter((row) => row.purchased);
  const missing = bought.filter((row) => shoppingLineCost(row).state === "missing");
  return {
    boughtLines: bought.length,
    costedLines: bought.length - missing.length,
    missing: missing.map((row) => ({ propertyName: row.propertyName, itemName: row.itemName, quantity: row.actualPurchasedQty })),
  };
}

/** "Hand wash refill ×3 for Bondi Beach House" for each missing line, joined in words. */
export function describeMissingCosts(coverage: ShoppingCostCoverage): string | null {
  if (!coverage.missing.length) return null;
  const parts = coverage.missing.map((line) => `${line.itemName} ×${line.quantity} for ${line.propertyName}`);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
