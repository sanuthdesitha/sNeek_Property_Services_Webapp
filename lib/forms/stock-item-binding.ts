/**
 * Binding the Stock count questions of a portable form file to this
 * database's inventory items.
 *
 * A Stock count stores the InventoryItem id it counts. Ids differ between
 * databases, so a hand-authored form file (docs/forms/*.json) names each item
 * by its SKU instead (e.g. "DEF-TP") and a name that says the item still has to
 * be picked. Imported through the Forms library as it is, such a question
 * counts an item that does not exist: its counts go to office review and its
 * urgent-stock effect is skipped with a reason — never treated as a real count.
 *
 * This function swaps each SKU for the matching active item's id and name.
 * Questions that already hold a known item id are left alone, and a SKU with
 * no active item is reported as missing, never guessed.
 *
 * PURE: no database.
 */
import { isNode, type SchemaNode } from "./template-questions";

export type StockItemRef = { id: string; sku: string | null; name: string; unit: string | null; isActive: boolean };

export type StockBindingEntry = { fieldId: string; sku: string; itemId: string; itemName: string };
export type StockBindingMissing = { fieldId: string; reference: string };

export type StockBindingResult = {
  schema: unknown;
  bound: StockBindingEntry[];
  missing: StockBindingMissing[];
};

function cloneSchema<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function questionsOf(schema: SchemaNode): SchemaNode[] {
  const sections = Array.isArray(schema.sections) ? schema.sections.filter(isNode) : [];
  return sections.flatMap((section) => {
    const fields = Array.isArray(section.fields) ? section.fields.filter(isNode) : [];
    return fields.flatMap((field) => [field, ...(Array.isArray(field.children) ? field.children.filter(isNode) : [])]);
  });
}

export function bindStockCountItemsBySku(schema: unknown, items: readonly StockItemRef[]): StockBindingResult {
  if (!isNode(schema)) return { schema, bound: [], missing: [] };
  const copy = cloneSchema(schema);
  const knownIds = new Set(items.map((item) => item.id));
  const activeBySku = new Map<string, StockItemRef>();
  for (const item of items) {
    if (item.isActive && item.sku) activeBySku.set(item.sku.trim().toUpperCase(), item);
  }
  const bound: StockBindingEntry[] = [];
  const missing: StockBindingMissing[] = [];
  for (const question of questionsOf(copy)) {
    if (question.type !== "stock_count") continue;
    const fieldId = String(question.id ?? "");
    const reference = typeof question.stockItemId === "string" ? question.stockItemId.trim() : "";
    if (reference && knownIds.has(reference)) continue;
    const item = reference ? activeBySku.get(reference.toUpperCase()) : undefined;
    if (!item) {
      missing.push({ fieldId, reference });
      continue;
    }
    question.stockItemId = item.id;
    question.stockItemName = item.name;
    if (item.unit) question.unit = item.unit;
    bound.push({ fieldId, sku: reference, itemId: item.id, itemName: item.name });
  }
  return { schema: copy, bound, missing };
}
