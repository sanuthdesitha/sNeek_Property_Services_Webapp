/**
 * Shopping-run GROUPING — the one place that decides how a run's lines are
 * bundled on screen. Pure and dependency-free on purpose (no `@/lib/db`, no
 * React) so the cleaner workspace, the client workspace and the unit tests all
 * agree on exactly the same shape.
 *
 * Three modes:
 *   property → one card per property   (walk the run property by property)
 *   item     → one card per item        (grab 6 shampoos once, split later)
 *   supplier → one card per supplier    (one stop per shop)
 *
 * The DEFAULT mode is an admin setting, not a hardcode — see
 * `lib/inventory/shopping-settings.ts`, surfaced on the admin inventory hub.
 */

export const SHOPPING_GROUP_MODES = ["property", "item", "supplier"] as const;

export type ShoppingGroupMode = (typeof SHOPPING_GROUP_MODES)[number];

export const DEFAULT_SHOPPING_GROUP_MODE: ShoppingGroupMode = "property";

export const SHOPPING_GROUP_MODE_LABELS: Record<ShoppingGroupMode, string> = {
  property: "By property",
  item: "By item",
  supplier: "By supplier",
};

export const UNASSIGNED_SUPPLIER_LABEL = "Unassigned supplier";

/**
 * The subset of `ShoppingRunRow` (lib/inventory/shopping-runs.ts) the grouper
 * reads. Deliberately structural + widened to `null` so both the cleaner and
 * client row types satisfy it without a cast.
 */
export type ShoppingGroupableRow = {
  propertyId: string;
  propertyName: string;
  suburb?: string | null;
  itemId: string;
  itemName: string;
  category?: string | null;
  supplier?: string | null;
  unit?: string | null;
  plannedQty?: number | null;
  actualPurchasedQty?: number | null;
  include?: boolean;
  purchased?: boolean;
  isCustom?: boolean;
  estimatedLineCost?: number | null;
  actualLineCost?: number | null;
};

export type ShoppingGroup<T extends ShoppingGroupableRow> = {
  /** Stable React key — unique within a result set. */
  key: string;
  /** Heading (property name / item name / supplier name). */
  title: string;
  /** Secondary heading line; "" when there is nothing useful to add. */
  subtitle: string;
  rows: T[];
  lineCount: number;
  /** Distinct properties represented in this group. */
  propertyCount: number;
  /** Units planned across included lines. */
  plannedUnits: number;
  /** Units actually bought across purchased lines. */
  purchasedUnits: number;
  purchasedLineCount: number;
  estimatedCost: number;
  actualCost: number;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function num(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Case/whitespace-insensitive key so "Bunnings " and "bunnings" collapse. */
function foldKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Coerce anything (query string, JSON setting, stale localStorage) into a valid
 * mode. Unknown input falls back to the default rather than throwing — a bad
 * saved preference must never break the shopping screen.
 */
export function normalizeShoppingGroupMode(value: unknown): ShoppingGroupMode {
  if (typeof value !== "string") return DEFAULT_SHOPPING_GROUP_MODE;
  const candidate = value.trim().toLowerCase();
  return (SHOPPING_GROUP_MODES as readonly string[]).includes(candidate)
    ? (candidate as ShoppingGroupMode)
    : DEFAULT_SHOPPING_GROUP_MODE;
}

function groupIdentity(
  row: ShoppingGroupableRow,
  mode: ShoppingGroupMode
): { key: string; title: string } {
  if (mode === "item") {
    // Custom purchases mint a throwaway `custom:<uuid>` itemId, so grouping on
    // the id would give every one of them its own card. Fold them on the name
    // instead, which is what "by item" actually means to the shopper.
    const name = text(row.itemName) || "Unnamed item";
    const key = row.isCustom ? `item-name:${foldKey(name)}` : `item:${row.itemId}`;
    return { key, title: name };
  }
  if (mode === "supplier") {
    const supplier = text(row.supplier);
    return supplier
      ? { key: `supplier:${foldKey(supplier)}`, title: supplier }
      : { key: "supplier:__unassigned__", title: UNASSIGNED_SUPPLIER_LABEL };
  }
  return {
    key: `property:${row.propertyId}`,
    title: text(row.propertyName) || "Unnamed property",
  };
}

function buildSubtitle(
  mode: ShoppingGroupMode,
  rows: ShoppingGroupableRow[],
  propertyCount: number
): string {
  if (mode === "property") return text(rows[0]?.suburb);
  if (mode === "item") {
    const category = text(rows[0]?.category);
    const unit = text(rows[0]?.unit);
    const spread = `${propertyCount} ${propertyCount === 1 ? "property" : "properties"}`;
    return [category, unit ? `per ${unit}` : "", spread].filter(Boolean).join(" · ");
  }
  const lines = `${rows.length} ${rows.length === 1 ? "line" : "lines"}`;
  const spread = `${propertyCount} ${propertyCount === 1 ? "property" : "properties"}`;
  return `${lines} · ${spread}`;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-AU", { sensitivity: "base", numeric: true });
}

function sortRows<T extends ShoppingGroupableRow>(rows: T[], mode: ShoppingGroupMode): T[] {
  const sorted = [...rows];
  if (mode === "property") {
    sorted.sort(
      (a, b) =>
        compareText(text(a.category), text(b.category)) ||
        compareText(text(a.itemName), text(b.itemName))
    );
    return sorted;
  }
  if (mode === "item") {
    sorted.sort((a, b) => compareText(text(a.propertyName), text(b.propertyName)));
    return sorted;
  }
  sorted.sort(
    (a, b) =>
      compareText(text(a.itemName), text(b.itemName)) ||
      compareText(text(a.propertyName), text(b.propertyName))
  );
  return sorted;
}

/**
 * Bundle a run's rows into display groups for `mode`.
 *
 * Immutable: the input array and its rows are never mutated — every group holds
 * a fresh, sorted array of the SAME row objects, so callers can keep using
 * identity (`itemId` + `propertyId`) to write back into run state.
 *
 * Groups come back sorted by title (then key) so the order is stable across
 * re-renders and identical for every viewer.
 */
export function groupShoppingRows<T extends ShoppingGroupableRow>(
  rows: readonly T[],
  mode: ShoppingGroupMode
): ShoppingGroup<T>[] {
  const safeMode = normalizeShoppingGroupMode(mode);
  const buckets = new Map<string, { title: string; rows: T[] }>();

  for (const row of rows ?? []) {
    if (!row) continue;
    const { key, title } = groupIdentity(row, safeMode);
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(row);
    else buckets.set(key, { title, rows: [row] });
  }

  const groups: ShoppingGroup<T>[] = [];
  // Array.from rather than iterating the Map directly — the repo's tsconfig
  // target predates downlevelIteration.
  for (const [key, bucket] of Array.from(buckets.entries())) {
    const sorted = sortRows(bucket.rows, safeMode);
    const propertyCount = new Set(sorted.map((r) => r.propertyId)).size;
    groups.push({
      key,
      title: bucket.title,
      subtitle: buildSubtitle(safeMode, sorted, propertyCount),
      rows: sorted,
      lineCount: sorted.length,
      propertyCount,
      plannedUnits: round2(
        sorted.reduce((sum, r) => (r.include === false ? sum : sum + num(r.plannedQty)), 0)
      ),
      purchasedUnits: round2(
        sorted.reduce((sum, r) => (r.purchased ? sum + num(r.actualPurchasedQty) : sum), 0)
      ),
      purchasedLineCount: sorted.filter((r) => r.purchased === true).length,
      estimatedCost: round2(sorted.reduce((sum, r) => sum + num(r.estimatedLineCost), 0)),
      actualCost: round2(sorted.reduce((sum, r) => sum + num(r.actualLineCost), 0)),
    });
  }

  groups.sort((a, b) => compareText(a.title, b.title) || a.key.localeCompare(b.key));
  return groups;
}
