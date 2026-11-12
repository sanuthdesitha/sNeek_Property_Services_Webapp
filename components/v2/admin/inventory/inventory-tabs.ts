/**
 * Stock page tab ids (server and browser). Pure.
 *
 * Wave F: the tabs are named and ordered as drawn (Urgent needs, Levels by
 * property, Shopping runs, Stock counts, Catalogue), then On-hand, Scan tasks
 * and Suppliers. Ids are unchanged so every old `?tab=` link keeps its tab;
 * the drawn names also work.
 */
export type InventoryTab =
  | "items"
  | "properties"
  | "on-hand"
  | "stock-counts"
  | "scan-tasks"
  | "shopping-runs"
  | "suppliers"
  | "urgent-stock";

export const INVENTORY_TAB_KEYS: InventoryTab[] = ["urgent-stock", "properties", "shopping-runs", "stock-counts", "items", "on-hand", "scan-tasks", "suppliers"];

/** Drawn names and short forms that open an existing tab. */
const TAB_ALIASES: Record<string, InventoryTab> = {
  urgent: "urgent-stock",
  "urgent-needs": "urgent-stock",
  levels: "properties",
  "levels-by-property": "properties",
  "by-property": "properties",
  catalogue: "items",
  catalog: "items",
  shopping: "shopping-runs",
  counts: "stock-counts",
  "on-hand-stock": "on-hand",
};

/**
 * The tab a `?tab=` value opens. Every old id keeps its tab; a drawn name maps
 * to its tab; Urgent needs (and a bare URL) only when the viewer may see it.
 */
export function normalizeInventoryTab(value: string | undefined, canSeeUrgentStock: boolean): InventoryTab {
  if (!value) return canSeeUrgentStock ? "urgent-stock" : "items";
  const key = (INVENTORY_TAB_KEYS as string[]).includes(value) ? (value as InventoryTab) : TAB_ALIASES[value.toLowerCase()];
  if (!key) return "items";
  if (key === "urgent-stock" && !canSeeUrgentStock) return "items";
  return key;
}
