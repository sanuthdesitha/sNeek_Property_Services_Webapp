import { db } from "@/lib/db";
import {
  DEFAULT_SHOPPING_GROUP_MODE,
  normalizeShoppingGroupMode,
  type ShoppingGroupMode,
} from "@/lib/inventory/shopping-grouping";

/**
 * Where the DEFAULT shopping-run grouping lives. Stored in the existing
 * key/value `AppSetting` table (same pattern as `lib/inventory/unit-costs.ts`)
 * so the preference is admin-settable without a schema change.
 *
 * Shape: { "mode": "property" | "item" | "supplier" }
 */
export const SHOPPING_GROUPING_SETTING_KEY = "inventory_shopping_grouping_v1";

/**
 * The admin-configured default. Falls back to the module default when unset —
 * and also when the read FAILS, because an unreachable settings row must never
 * stop a cleaner opening their shopping run.
 */
export async function getShoppingGroupMode(): Promise<ShoppingGroupMode> {
  try {
    const row = await db.appSetting.findUnique({ where: { key: SHOPPING_GROUPING_SETTING_KEY } });
    const value = row?.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return normalizeShoppingGroupMode((value as Record<string, unknown>).mode);
    }
    return normalizeShoppingGroupMode(value);
  } catch {
    return DEFAULT_SHOPPING_GROUP_MODE;
  }
}

/** Persist the default grouping. Unknown input is normalised, never stored raw. */
export async function setShoppingGroupMode(mode: unknown): Promise<ShoppingGroupMode> {
  const clean = normalizeShoppingGroupMode(mode);
  await db.appSetting.upsert({
    where: { key: SHOPPING_GROUPING_SETTING_KEY },
    create: { key: SHOPPING_GROUPING_SETTING_KEY, value: { mode: clean } },
    update: { value: { mode: clean } },
  });
  return clean;
}
