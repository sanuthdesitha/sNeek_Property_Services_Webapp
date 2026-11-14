/**
 * Standard starting stock lists for a new property (owner default 2026-11-16,
 * pending owner confirmation): one list each for 1, 2 and 3+ bedrooms. Items
 * are the existing default inventory catalog (lib/inventory/default-items.ts,
 * by SKU) so activation creates ordinary PropertyStock rows. The office edits
 * the rows per property before activation; a missing par or reorder level is
 * left out on activation, never stored as zero.
 *
 * Plain module: the stock step and the activation code read it.
 */
import type { OnboardingStockRow, StockStartingList } from "./types";

export const STOCK_STARTING_LIST_LABELS: Record<StockStartingList, string> = {
  ONE_BED: "1-bed list",
  TWO_BED: "2-bed list",
  THREE_PLUS: "3+ bed list",
};

type ListItem = { sku: string; name: string; unit: string; par: [number, number, number]; reorder: [number, number, number] };

// [1 bed, 2 bed, 3+ bed]
const ITEMS: readonly ListItem[] = [
  { sku: "DEF-TP", name: "Toilet Paper", unit: "roll", par: [8, 12, 18], reorder: [4, 6, 9] },
  { sku: "DEF-HANDSOAP", name: "Hand Soap", unit: "bottle", par: [1, 2, 3], reorder: [1, 1, 2] },
  { sku: "DEF-SHAMPOO", name: "Shampoo", unit: "bottle", par: [2, 3, 4], reorder: [1, 1, 2] },
  { sku: "DEF-CONDITIONER", name: "Conditioner", unit: "bottle", par: [2, 3, 4], reorder: [1, 1, 2] },
  { sku: "DEF-BODYWASH", name: "Body Wash", unit: "bottle", par: [2, 3, 4], reorder: [1, 1, 2] },
  { sku: "DEF-COFFEECAPS", name: "Coffee Capsules", unit: "capsule", par: [12, 20, 30], reorder: [6, 10, 15] },
  { sku: "DEF-TEABAG", name: "Tea Bags", unit: "bag", par: [10, 20, 30], reorder: [5, 10, 15] },
  { sku: "DEF-DISHLIQUID", name: "Dishwashing Liquid", unit: "bottle", par: [1, 2, 2], reorder: [1, 1, 1] },
  { sku: "DEF-PAPERTOWEL", name: "Paper Towels", unit: "roll", par: [2, 3, 4], reorder: [1, 1, 2] },
  { sku: "DEF-BINBAG-L", name: "Bin Bags (Large)", unit: "bag", par: [10, 15, 20], reorder: [4, 6, 8] },
  { sku: "DEF-SCRUBPAD", name: "Kitchen Scrubbing Pads", unit: "pack", par: [1, 2, 2], reorder: [1, 1, 1] },
];

const INDEX: Record<StockStartingList, 0 | 1 | 2> = { ONE_BED: 0, TWO_BED: 1, THREE_PLUS: 2 };

export function stockStartingList(list: StockStartingList): OnboardingStockRow[] {
  const at = INDEX[list];
  return ITEMS.map((entry) => ({ sku: entry.sku, name: entry.name, unit: entry.unit, parLevel: entry.par[at], reorderAt: entry.reorder[at] }));
}

/** The list that matches a bedroom count (unknown or 0 → the 1-bed list). */
export function suggestedStartingList(bedrooms: number | null | undefined): StockStartingList {
  if (typeof bedrooms !== "number" || bedrooms <= 1) return "ONE_BED";
  return bedrooms === 2 ? "TWO_BED" : "THREE_PLUS";
}

export const STOCK_LIST_SKUS: readonly string[] = ITEMS.map((entry) => entry.sku);
