/**
 * Template-level inventory capture configuration (R8a).
 *
 * The cleaner form's "Stock & consumables used" block historically always
 * showed EVERY active PropertyStock row for the property. Templates can now
 * carry `schema.inventoryConfig` to narrow that list:
 *
 *   { mode: "all" }                        → every stocked item (default)
 *   { mode: "selected", itemIds: [...] }   → only the listed InventoryItem ids
 *                                            (empty selection = show none)
 *
 * Pure helpers — used by the form read route (to filter the `inventoryStock`
 * payload), the builder (to edit the config), and tests.
 */

export interface InventoryConfig {
  mode: "all" | "selected";
  itemIds: string[];
}

/** Minimal PropertyStock shape: the scalar `itemId` and/or the included `item`. */
export interface InventoryStockLike {
  itemId?: string | null;
  item?: { id?: string | null } | null;
}

/** Parse an untrusted schema value into a valid config (or undefined = all). */
export function normalizeInventoryConfig(input: unknown): InventoryConfig | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const mode = raw.mode === "selected" ? "selected" : raw.mode === "all" ? "all" : undefined;
  if (!mode) return undefined;
  const itemIds = Array.isArray(raw.itemIds)
    ? Array.from(
        new Set(
          raw.itemIds
            .filter((v): v is string => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean)
        )
      )
    : [];
  return { mode, itemIds };
}

function stockItemId(row: InventoryStockLike): string | null {
  const fromItem = row?.item?.id;
  if (typeof fromItem === "string" && fromItem) return fromItem;
  const scalar = row?.itemId;
  if (typeof scalar === "string" && scalar) return scalar;
  return null;
}

/**
 * Apply an inventory config to a property's stock rows.
 * - undefined / mode "all" → every row (historic behaviour)
 * - mode "selected"        → only rows whose item id is in the selection;
 *                            an empty selection shows none. Unknown ids are
 *                            simply not matched.
 */
export function filterStockByConfig<T extends InventoryStockLike>(
  stock: T[],
  config?: InventoryConfig | null
): T[] {
  const rows = Array.isArray(stock) ? stock : [];
  if (!config || config.mode === "all") return rows;
  const allowed = new Set(config.itemIds);
  if (allowed.size === 0) return [];
  return rows.filter((row) => {
    const id = stockItemId(row);
    return id != null && allowed.has(id);
  });
}
