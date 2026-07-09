/**
 * Server-safe shared contract for the Estate per-property inventory matrix.
 *
 * These runtime helpers (STALE_RESTOCK_DAYS, normalizePropertyInventoryFilter)
 * and the row/totals types are consumed by BOTH the server hub page
 * (app/v2/admin/inventory/page.tsx) and the "use client" matrix component
 * (estate-property-matrix.tsx). They must live in a NON-client module: importing
 * a plain function/const out of a "use client" file into a Server Component yields
 * a client-reference proxy rather than the real value, so calling
 * normalizePropertyInventoryFilter() server-side throws "is not a function".
 */

export type PropertyInventoryFilter = "all" | "low" | "pending" | "stale";

export type EstatePropertyInventoryRow = {
  id: string;
  name: string;
  address: string;
  suburb: string;
  inventoryEnabled: boolean;
  client: { name: string };
  trackedItems: number;
  lowStockItems: Array<{ id: string; name: string; onHand: number; reorderThreshold: number }>;
  pendingShoppingRuns: number;
  pendingShoppingRunsList: Array<{ id: string; title: string; status: string }>;
  openStockRuns: number;
  lastRestockAt: Date | string | null;
};

export type EstatePropertyInventoryTotals = {
  properties: number;
  lowStock: number;
  pendingShopping: number;
  stale: number;
};

export const STALE_RESTOCK_DAYS = 30;

export function normalizePropertyInventoryFilter(
  value: string | undefined,
): PropertyInventoryFilter {
  if (value === "low" || value === "pending" || value === "stale") return value;
  return "all";
}
