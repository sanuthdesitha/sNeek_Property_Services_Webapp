import "server-only";
/**
 * Creates the onboarding stock list on activation: ordinary PropertyStock rows
 * for the default catalog items named by SKU, with the par and reorder levels
 * the office set. Existing rows are left exactly as they are (re-activation is
 * a no-op). A row without a par level is not created and is reported, never
 * stored with a made-up zero.
 *
 * On hand: PropertyStock.onHand cannot be empty in the schema, so it starts at
 * the par level, exactly as the existing default-stock seeding does
 * (lib/inventory/default-items.ts). The first stock count corrects it.
 */
import { db } from "@/lib/db";
import { DEFAULT_INVENTORY_ITEMS, ensureDefaultInventoryItems } from "@/lib/inventory/default-items";

export type OnboardingStockActivationRow = { sku: string; parLevel: number | null; reorderAt: number | null };

export async function applyOnboardingStockList(propertyId: string, rows: readonly OnboardingStockActivationRow[]): Promise<{ created: number; warnings: string[] }> {
  const warnings: string[] = [];
  const catalog = await ensureDefaultInventoryItems();
  const bySku = new Map(catalog.map((item) => [item.sku, item.id]));
  let created = 0;
  const withoutPar: string[] = [];
  const unknown: string[] = [];
  const defaultReorder: string[] = [];
  for (const row of rows) {
    const itemId = bySku.get(row.sku);
    if (!itemId) {
      unknown.push(row.sku);
      continue;
    }
    if (typeof row.parLevel !== "number" || !Number.isFinite(row.parLevel)) {
      withoutPar.push(row.sku);
      continue;
    }
    const existing = await db.propertyStock.findUnique({ where: { propertyId_itemId: { propertyId, itemId } }, select: { id: true } });
    if (existing) continue;
    await db.propertyStock.create({
      data: {
        propertyId,
        itemId,
        parLevel: row.parLevel,
        onHand: row.parLevel,
        reorderThreshold: reorderLevel(row, defaultReorder),
      },
    });
    created += 1;
  }
  if (withoutPar.length) warnings.push(`${withoutPar.length} stock item${withoutPar.length === 1 ? " had" : "s had"} no par level and ${withoutPar.length === 1 ? "was" : "were"} not created.`);
  if (defaultReorder.length) warnings.push(`${defaultReorder.length} stock item${defaultReorder.length === 1 ? " had" : "s had"} no reorder level; the catalog's standard level was used.`);
  if (unknown.length) warnings.push(`${unknown.length} stock item${unknown.length === 1 ? " is" : "s are"} not in the stock catalog and ${unknown.length === 1 ? "was" : "were"} not created.`);
  return { created, warnings };
}

/** The office's reorder level, or the catalog's standard one (reported), never an invented zero. */
function reorderLevel(row: OnboardingStockActivationRow, usedDefault: string[]): number {
  if (typeof row.reorderAt === "number" && Number.isFinite(row.reorderAt)) return row.reorderAt;
  usedDefault.push(row.sku);
  return DEFAULT_INVENTORY_ITEMS.find((item) => item.sku === row.sku)?.defaultThreshold ?? 1;
}
