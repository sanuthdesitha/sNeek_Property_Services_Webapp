import { db } from "@/lib/db";

const UNIT_COSTS_KEY = "inventory_unit_costs_v1";

export type InventoryUnitCostMap = Record<string, number>;

function sanitizeCostMap(value: unknown): InventoryUnitCostMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: InventoryUnitCostMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw);
    if (key && Number.isFinite(n) && n >= 0) out[key] = n;
  }
  return out;
}

export async function getInventoryUnitCosts(): Promise<InventoryUnitCostMap> {
  const row = await db.appSetting.findUnique({ where: { key: UNIT_COSTS_KEY } });
  return sanitizeCostMap(row?.value);
}

export async function setInventoryUnitCosts(costs: InventoryUnitCostMap): Promise<InventoryUnitCostMap> {
  const clean = sanitizeCostMap(costs);
  await db.appSetting.upsert({
    where: { key: UNIT_COSTS_KEY },
    create: { key: UNIT_COSTS_KEY, value: clean as any },
    update: { value: clean as any },
  });
  return clean;
}

export async function setInventoryItemUnitCost(itemId: string, unitCost?: number | null) {
  const costs = await getInventoryUnitCosts();
  if (unitCost === undefined || unitCost === null || !Number.isFinite(unitCost) || unitCost < 0) {
    delete costs[itemId];
  } else {
    costs[itemId] = unitCost;
  }
  await setInventoryUnitCosts(costs);
  return costs;
}

