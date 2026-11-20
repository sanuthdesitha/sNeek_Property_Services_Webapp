/**
 * The "Stock used" table question (field type `inventory`).
 *
 * The cleaner enters, for each stock item of the job's property that the
 * question shows, how many were USED this clean. The builder chooses which
 * items a question shows ("Show": all items, kitchen, bathroom, laundry or
 * other). Usage is deducted from the property's stock on submit through the
 * existing once-per-job deduction (lib/cleaner/submission-stock.ts).
 *
 * Answer storage. Every stock table on a form shares ONE answer per item,
 * kept under the reserved answer key `stockTableUsage` (itemId → whole
 * number). A row without a key is unanswered; an explicit 0 is an answer.
 * Two questions that show the same item (a Kitchen table and an "All items"
 * table) therefore show the same number and the item is deducted once.
 *
 * Legacy templates. The original seed wrote `{ type: "inventory", items:
 * [SKU or id, …] }` (and some hand-made forms `location` / `locations`). Those
 * read as an item list (matched by id or SKU) and an exact storage-location
 * filter, so a stored legacy question shows the items it always meant.
 *
 * Areas come from the item's existing `location` (KITCHEN, BATHROOM) and, for
 * everything else, its `category` (see stockItemArea). Nothing new is stored
 * on items.
 *
 * PURE: no database, no React. Imported by the server and the cleaner app.
 */
import { flattenFieldsOneLevel, isFlattenedFieldVisible, isTemplateNodeVisible } from "./visibility";

/** Reserved answer key holding every stock table's usage (itemId → number). */
export const STOCK_TABLE_USAGE_KEY = "stockTableUsage";
/** Controlled submission key: the server's record of what each table showed. */
export const STOCK_TABLE_RECORD_KEY = "__stockTable";
export const STOCK_TABLE_FIELD_TYPE = "inventory";
export const STOCK_USED_MAX = 100_000;

export type StockArea = "kitchen" | "bathroom" | "laundry" | "other";
export type StockTableShow = "all" | StockArea;

export const STOCK_TABLE_SHOW_OPTIONS: ReadonlyArray<{ value: StockTableShow; label: string }> = [
  { value: "all", label: "All items" },
  { value: "kitchen", label: "Kitchen" },
  { value: "bathroom", label: "Bathroom" },
  { value: "laundry", label: "Laundry" },
  { value: "other", label: "Other" },
];

const SHOW_VALUES: ReadonlySet<string> = new Set(STOCK_TABLE_SHOW_OPTIONS.map((option) => option.value));

/** One stock row as the cleaner receives it: no cost, par, supplier or threshold. */
export type StockTableItem = {
  itemId: string;
  name: string;
  sku: string | null;
  unit: string | null;
  /** Normalised storage location (KITCHEN, BATHROOM, CLEANERS_CUPBOARD, …). */
  location: string | null;
  area: StockArea;
  /** Current on-hand at the property, or null when it is not known. */
  onHand: number | null;
};

/**
 * The property's stock for the job, as the form payload carries it.
 *  ready        the list was read (`tracked: false` = the property does not
 *               track stock, so the table has nothing to ask);
 *  unavailable  the read failed: never shown as "no items".
 */
export type StockTableStock =
  | { status: "ready"; tracked: boolean; items: StockTableItem[] }
  | { status: "unavailable"; message: string };

export type StockTableConfig = {
  show: StockTableShow;
  includeZeroOnHand: boolean;
  /** Legacy `items`: ids or SKUs the question was limited to (empty = no limit). */
  itemRefs: string[];
  /** Legacy `location` / `locations`: exact storage locations (empty = no limit). */
  legacyLocations: string[];
};

type Node = Record<string, unknown>;

/** A stored "Stock used" question, read tolerantly (any extra keys allowed). */
export type StockTableFieldLike = {
  stockArea?: unknown;
  includeZeroOnHand?: unknown;
  items?: unknown;
  location?: unknown;
  locations?: unknown;
  required?: unknown;
};

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normaliseLocation(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/^CLEANER_/, "CLEANERS_");
}

/**
 * Which area an item belongs to, from data items already carry:
 *  - location KITCHEN → kitchen, BATHROOM → bathroom (the location is what
 *    the office set for where the item is kept);
 *  - otherwise the category: one naming laundry, kitchen or bath(room);
 *  - everything else (cleaning products, amenities, general) → other.
 */
export function stockItemArea(item: { location?: unknown; category?: unknown }): StockArea {
  const location = normaliseLocation(item.location);
  if (location === "KITCHEN") return "kitchen";
  if (location === "BATHROOM") return "bathroom";
  if (location === "LAUNDRY") return "laundry";
  const category = typeof item.category === "string" ? item.category.trim().toLowerCase() : "";
  if (category.includes("laundry")) return "laundry";
  if (category.includes("kitchen")) return "kitchen";
  if (category.includes("bath")) return "bathroom";
  return "other";
}

export function stockAreaLabel(area: StockTableShow): string {
  return STOCK_TABLE_SHOW_OPTIONS.find((option) => option.value === area)?.label ?? "All items";
}

/** "Kitchen", "All items · including none on hand", "Items: DEF-TP, DEF-SHAMPOO" (builder badges, Compare). */
export function stockTableShownText(field: object): string {
  const config = readStockTableConfig(field);
  const parts = [stockAreaLabel(config.show)];
  if (config.legacyLocations.length > 0) parts.push(`kept in ${config.legacyLocations.join(", ").toLowerCase().replace(/_/g, " ")}`);
  if (config.itemRefs.length > 0) parts.push(`${config.itemRefs.length} listed item${config.itemRefs.length === 1 ? "" : "s"}`);
  if (!config.includeZeroOnHand) parts.push("hides items with none on hand");
  return parts.join(" · ");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)));
}

/** The question's settings, read tolerantly (unknown values fall back to "all"). */
export function readStockTableConfig(question: object): StockTableConfig {
  const field = question as StockTableFieldLike;
  const show = typeof field.stockArea === "string" && SHOW_VALUES.has(field.stockArea) ? (field.stockArea as StockTableShow) : "all";
  const legacyLocations = stringList(field.locations).map(normaliseLocation).filter(Boolean);
  if (legacyLocations.length === 0 && typeof field.location === "string" && field.location.trim()) {
    legacyLocations.push(normaliseLocation(field.location));
  }
  return {
    show,
    includeZeroOnHand: field.includeZeroOnHand !== false,
    itemRefs: stringList(field.items),
    legacyLocations,
  };
}

/** The rows a question shows for this property, in the order the stock list gives. */
export function stockTableRows(field: object, items: readonly StockTableItem[]): StockTableItem[] {
  const config = readStockTableConfig(field);
  const refs = new Set(config.itemRefs.map((ref) => ref.toUpperCase()));
  return items.filter((item) => {
    if (config.show !== "all" && item.area !== config.show) return false;
    if (config.legacyLocations.length > 0 && !config.legacyLocations.includes(normaliseLocation(item.location))) return false;
    if (refs.size > 0 && !refs.has(item.itemId.toUpperCase()) && !(item.sku && refs.has(item.sku.toUpperCase()))) return false;
    if (!config.includeZeroOnHand && item.onHand !== null && item.onHand <= 0) return false;
    return true;
  });
}

/** The shared usage map from the answers (never throws on a bad shape). */
export function readStockTableUsage(answers: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const raw = answers?.[STOCK_TABLE_USAGE_KEY];
  return isNode(raw) ? raw : {};
}

export type StockUsedValue =
  | { state: "unanswered" }
  | { state: "answered"; quantity: number }
  | { state: "invalid"; message: string };

/** One row's value: unanswered, a whole number 0…STOCK_USED_MAX, or a refusal in words. */
export function readStockUsedValue(raw: unknown): StockUsedValue {
  if (raw === undefined || raw === null || raw === "") return { state: "unanswered" };
  const quantity = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isFinite(quantity)) return { state: "invalid", message: "must be a number" };
  if (quantity < 0) return { state: "invalid", message: "cannot be less than 0" };
  if (!Number.isInteger(quantity)) return { state: "invalid", message: "must be a whole number of items" };
  if (quantity > STOCK_USED_MAX) return { state: "invalid", message: `cannot be more than ${STOCK_USED_MAX}` };
  return { state: "answered", quantity };
}

function namesList(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/**
 * The one problem with a visible stock table, or null. `stock` undefined
 * means the caller has no stock list (a builder preview): not checked.
 * The cleaner's phone and the submit route call this with the same list.
 */
export function stockTableFieldError(
  question: object,
  answers: Record<string, unknown>,
  stock: StockTableStock | undefined,
): string | null {
  const field = question as StockTableFieldLike;
  if (!stock) return null;
  if (stock.status === "unavailable") {
    return field.required === true ? "The stock list could not be loaded. Try again before submitting." : null;
  }
  const rows = stockTableRows(field, stock.items);
  const usage = readStockTableUsage(answers);
  const missing: string[] = [];
  for (const row of rows) {
    const value = readStockUsedValue(usage[row.itemId]);
    if (value.state === "invalid") return `${row.name}: the amount used ${value.message}.`;
    if (value.state === "unanswered") missing.push(row.name);
  }
  if (field.required === true && missing.length > 0) {
    return `Enter how many were used for each item (0 if none). Not answered: ${namesList(missing)}.`;
  }
  return null;
}

/** What one visible table showed and the answer per row (null = not answered). */
export type StockTableRecordField = {
  fieldId: string;
  label: string;
  show: StockTableShow;
  rows: Array<{ itemId: string; name: string; unit: string | null; used: number | null }>;
};

export type StockTableResolution = {
  /** Item → quantity used (> 0 only), each item once. */
  usage: Record<string, number>;
  /** Items shown by at least one visible table (the block does not record these). */
  coveredItemIds: string[];
  fields: StockTableRecordField[];
  /** Keys in the usage map that no visible table showed: not deducted. */
  ignoredItemIds: string[];
};

type VisibilityInput = {
  schema: unknown;
  answers: Record<string, unknown>;
  property: Record<string, unknown>;
  laundryReady?: boolean;
};

/** Visible stock table questions, in form order. */
export function visibleStockTableFields({ schema, answers, property, laundryReady }: VisibilityInput): Array<Node & { id: string }> {
  const sections = isNode(schema) && Array.isArray(schema.sections) ? schema.sections : [];
  const out: Array<Node & { id: string }> = [];
  for (const section of sections) {
    if (!isNode(section) || !isTemplateNodeVisible(section, answers, property, laundryReady)) continue;
    for (const field of flattenFieldsOneLevel(section.fields)) {
      if (field?.type !== STOCK_TABLE_FIELD_TYPE || typeof field.id !== "string") continue;
      if (!isFlattenedFieldVisible(field, answers, property, laundryReady)) continue;
      out.push(field);
    }
  }
  return out;
}

/** True when the schema has any stock table question (visible or not). */
export function schemaHasStockTable(schema: unknown): boolean {
  const sections = isNode(schema) && Array.isArray(schema.sections) ? schema.sections : [];
  return sections.some((section) => isNode(section) && flattenFieldsOneLevel(section.fields).some((field: Node) => field?.type === STOCK_TABLE_FIELD_TYPE));
}

/** Items any visible table shows: the "Stock & consumables used" block leaves them out. */
export function coveredStockItemIds(input: VisibilityInput, items: readonly StockTableItem[]): Set<string> {
  const covered = new Set<string>();
  for (const field of visibleStockTableFields(input)) {
    for (const row of stockTableRows(field, items)) covered.add(row.itemId);
  }
  return covered;
}

/**
 * The server's reading of the stock tables against the property's current
 * stock: one quantity per item (shared answer), the covered items and a
 * record of each table. Call only after stockTableFieldError found nothing.
 */
export function resolveStockTableUsage(input: VisibilityInput, items: readonly StockTableItem[]): StockTableResolution {
  const usageMap = readStockTableUsage(input.answers);
  const usage: Record<string, number> = {};
  const covered = new Set<string>();
  const fields: StockTableRecordField[] = [];
  for (const field of visibleStockTableFields(input)) {
    const rows = stockTableRows(field, items);
    fields.push({
      fieldId: field.id,
      label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.id,
      show: readStockTableConfig(field).show,
      rows: rows.map((row) => {
        const value = readStockUsedValue(usageMap[row.itemId]);
        return { itemId: row.itemId, name: row.name, unit: row.unit, used: value.state === "answered" ? value.quantity : null };
      }),
    });
    for (const row of rows) {
      covered.add(row.itemId);
      const value = readStockUsedValue(usageMap[row.itemId]);
      if (value.state === "answered" && value.quantity > 0) usage[row.itemId] = value.quantity;
    }
  }
  const ignoredItemIds = Object.keys(usageMap).filter((itemId) => !covered.has(itemId)).sort();
  return { usage, coveredItemIds: Array.from(covered).sort(), fields, ignoredItemIds };
}

/**
 * Precedence between the "Stock & consumables used" block and the tables:
 * a table replaces the block for the items it shows, so an item is never
 * deducted twice. Returns undefined when nothing was used.
 */
export function mergeStockUsage(
  blockUsage: Record<string, number> | undefined,
  table: Pick<StockTableResolution, "usage" | "coveredItemIds">,
): Record<string, number> | undefined {
  const covered = new Set(table.coveredItemIds);
  const merged: Record<string, number> = {};
  for (const [itemId, quantity] of Object.entries(blockUsage ?? {})) {
    if (!covered.has(itemId) && quantity > 0) merged[itemId] = quantity;
  }
  for (const [itemId, quantity] of Object.entries(table.usage)) {
    if (quantity > 0) merged[itemId] = quantity;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Cleaner-safe stock rows from PropertyStock rows with their item (no cost or supplier read). */
export function toStockTableItems(
  rows: ReadonlyArray<{ onHand?: unknown; item?: { id?: unknown; name?: unknown; sku?: unknown; unit?: unknown; location?: unknown; category?: unknown } | null }>,
): StockTableItem[] {
  const out: StockTableItem[] = [];
  for (const row of rows) {
    const item = row.item;
    if (!item || typeof item.id !== "string" || !item.id) continue;
    const onHand = typeof row.onHand === "number" && Number.isFinite(row.onHand) ? row.onHand : null;
    out.push({
      itemId: item.id,
      name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Item",
      sku: typeof item.sku === "string" && item.sku.trim() ? item.sku.trim() : null,
      unit: typeof item.unit === "string" && item.unit.trim() ? item.unit.trim() : null,
      location: normaliseLocation(item.location) || null,
      area: stockItemArea(item),
      onHand,
    });
  }
  return out;
}

/** Two visible-or-not tables whose "Show" settings can include the same item (answers are shared). */
export function overlappingStockTables(schema: unknown): Array<{ labels: [string, string] }> {
  const sections = isNode(schema) && Array.isArray(schema.sections) ? schema.sections : [];
  const tables: Array<{ label: string; show: StockTableShow; limited: boolean }> = [];
  for (const section of sections) {
    if (!isNode(section)) continue;
    for (const field of flattenFieldsOneLevel(section.fields)) {
      if (field?.type !== STOCK_TABLE_FIELD_TYPE) continue;
      const config = readStockTableConfig(field);
      tables.push({
        label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id ?? "question"),
        show: config.show,
        limited: config.itemRefs.length > 0 || config.legacyLocations.length > 0,
      });
    }
  }
  const pairs: Array<{ labels: [string, string] }> = [];
  for (let i = 0; i < tables.length; i += 1) {
    for (let j = i + 1; j < tables.length; j += 1) {
      const a = tables[i];
      const b = tables[j];
      // Legacy item lists are not compared item by item; only area settings are.
      if (a.limited || b.limited) continue;
      if (a.show === "all" || b.show === "all" || a.show === b.show) pairs.push({ labels: [a.label, b.label] });
    }
  }
  return pairs;
}

/* ── Office views: the submission's record ─────────────────────────────── */

/** One table's record on a submission (`data.__stockTable.fields`), or null (older submissions). */
export function stockTableRecordField(data: unknown, fieldId: string): StockTableRecordField | null {
  if (!isNode(data)) return null;
  const record = data[STOCK_TABLE_RECORD_KEY];
  if (!isNode(record) || !Array.isArray(record.fields)) return null;
  const entry = record.fields.find((field) => isNode(field) && field.fieldId === fieldId);
  if (!isNode(entry) || !Array.isArray(entry.rows)) return null;
  return {
    fieldId,
    label: typeof entry.label === "string" ? entry.label : fieldId,
    show: typeof entry.show === "string" && SHOW_VALUES.has(entry.show) ? (entry.show as StockTableShow) : "all",
    rows: entry.rows.filter(isNode).map((row) => ({
      itemId: String(row.itemId ?? ""),
      name: typeof row.name === "string" ? row.name : "Item",
      unit: typeof row.unit === "string" ? row.unit : null,
      used: typeof row.used === "number" && Number.isFinite(row.used) ? row.used : null,
    })),
  };
}

function usedText(row: StockTableRecordField["rows"][number]): string {
  if (row.used === null) return "Not answered";
  if (row.used === 0) return "None used";
  return `${row.used}${row.unit ? ` ${row.unit}` : ""}`;
}

/** Header and cells for a recorded table ("Item", "Used"); null when it showed no rows. */
export function stockTableRecordGrid(entry: StockTableRecordField | null): { columns: string[]; rows: string[][] } | null {
  if (!entry || entry.rows.length === 0) return null;
  return { columns: ["Item", "Used"], rows: entry.rows.map((row) => [row.name, usedText(row)]) };
}

/** Plain text of a recorded table: "Toilet paper: 2 roll; Hand soap: None used". */
export function formatStockTableRecord(entry: StockTableRecordField | null): string {
  if (!entry) return "-";
  if (entry.rows.length === 0) return "No items were shown for this property.";
  return entry.rows.map((row) => `${row.name}: ${usedText(row)}`).join("; ");
}
