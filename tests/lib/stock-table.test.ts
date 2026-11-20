// @vitest-environment node
/**
 * The "Stock used" table question (field type "inventory"), pure rules:
 * areas from existing item data, the legacy seed shape, rows per question,
 * unanswered vs an explicit 0, the required rule the phone and the server
 * share, several tables on one form (one shared answer per item), the
 * precedence over the "Stock & consumables used" block, the Checks, the save
 * check, export / import and the office record.
 */
import { describe, expect, it } from "vitest";
import {
  STOCK_TABLE_USAGE_KEY,
  coveredStockItemIds,
  formatStockTableRecord,
  mergeStockUsage,
  overlappingStockTables,
  readStockTableConfig,
  readStockUsedValue,
  resolveStockTableUsage,
  stockItemArea,
  stockTableFieldError,
  stockTableRecordField,
  stockTableRecordGrid,
  stockTableRows,
  toStockTableItems,
  type StockTableItem,
  type StockTableStock,
} from "@/lib/forms/stock-table";
import { DEFAULT_INVENTORY_ITEMS } from "@/lib/inventory/default-items";
import { checkTemplateSchema } from "@/lib/forms/template-checks";
import { validateFormSchemaForSave } from "@/lib/forms/template-schema";
import { collectFormErrors, collectStockTableErrors } from "@/lib/forms/validate-submission";
import { collectRequiredAnswerFields } from "@/lib/forms/visibility";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { buildExportFile, parseImportFile } from "@/lib/forms/template-transfer";
import { formatFieldValue, getFieldTypeDef } from "@/lib/forms/field-types";
import { questionTypeLabel } from "@/lib/forms/question-badges";

const items: StockTableItem[] = toStockTableItems(
  DEFAULT_INVENTORY_ITEMS.map((item, index) => ({
    onHand: item.sku === "DEF-TEABAG" ? 0 : index + 1,
    item: { id: `id-${item.sku}`, name: item.name, sku: item.sku, unit: item.unit, location: item.location, category: item.category },
  })),
);
const ready: StockTableStock = { status: "ready", tracked: true, items };
const names = (rows: StockTableItem[]) => rows.map((row) => row.name);
const section = (fields: unknown[], extra: Record<string, unknown> = {}) => ({ sections: [{ id: "s", title: "Rooms", fields }], ...extra });

/** The seed's own legacy questions (prisma/seed.ts). */
const LEGACY_KITCHEN = { id: "s4_inventory", type: "inventory", label: "Items used", inventoryUsage: true, items: ["DEF-PAPERTOWEL", "DEF-SCRUBPAD", "DEF-COFFEECAPS", "DEF-TEABAG"] };
const LEGACY_BATHROOM = { id: "s5_inventory", type: "inventory", label: "Bathroom supplies used", inventoryUsage: true, items: ["DEF-TP", "DEF-HANDSOAP", "DEF-SHAMPOO", "DEF-CONDITIONER", "DEF-BODYWASH"] };

describe("areas come from data items already carry", () => {
  it("maps location first, then category, else Other", () => {
    expect(stockItemArea({ location: "KITCHEN", category: "Cleaning" })).toBe("kitchen");
    expect(stockItemArea({ location: "bathroom" })).toBe("bathroom");
    expect(stockItemArea({ location: "CLEANERS_CUPBOARD", category: "Laundry" })).toBe("laundry");
    expect(stockItemArea({ location: "CLEANERS_CUPBOARD", category: "Kitchen supplies" })).toBe("kitchen");
    expect(stockItemArea({ location: "CLEANERS_CUPBOARD", category: "Cleaning" })).toBe("other");
    expect(stockItemArea({})).toBe("other");
  });

  it("puts the default catalogue's cupboard items in Other and the two laundry products in Laundry", () => {
    const area = (show: string) => names(stockTableRows({ stockArea: show }, items));
    expect(area("laundry")).toEqual(["Laundry Detergent (Powder)", "Laundry Liquid"]);
    expect(area("other")).toEqual([
      "Bin Bags (Small)", "Bin Bags (Large)", "Spray n Wipe", "Glass Spray", "Mold Spray", "Bin Bags (Medium)", "Fragrance Spray", "Batteries (AA)",
    ]);
    expect(area("kitchen")).toContain("Coffee Capsules");
    expect(area("bathroom")).toEqual(["Shampoo", "Body Wash", "Conditioner", "Hand Soap", "Toilet Paper"]);
    expect(area("all")).toHaveLength(items.length);
  });

  it("sends the cleaner no cost, par, threshold or supplier", () => {
    const [row] = toStockTableItems([{ onHand: 3, item: { id: "x", name: "Soap", unit: "bottle", location: "BATHROOM", supplier: "Costco", cost: 9.5 } as never }]);
    expect(Object.keys(row).sort()).toEqual(["area", "itemId", "location", "name", "onHand", "sku", "unit"]);
    expect(toStockTableItems([{ onHand: "lots" as never, item: { id: "y", name: "Bags" } }])[0].onHand).toBeNull();
  });
});

describe("rows per question", () => {
  it("reads the seed's legacy item lists by SKU (no data migration)", () => {
    expect(readStockTableConfig(LEGACY_KITCHEN).show).toBe("all");
    expect(names(stockTableRows(LEGACY_KITCHEN, items))).toEqual(["Paper Towels", "Kitchen Scrubbing Pads", "Coffee Capsules", "Tea Bags"]);
    expect(names(stockTableRows(LEGACY_BATHROOM, items))).toEqual(["Shampoo", "Body Wash", "Conditioner", "Hand Soap", "Toilet Paper"]);
    expect(names(stockTableRows({ items: ["id-DEF-TP"] }, items))).toEqual(["Toilet Paper"]);
    expect(names(stockTableRows({ location: "Bathroom" }, items))).toHaveLength(5);
  });

  it("hides items with none on hand only when asked", () => {
    expect(names(stockTableRows({ stockArea: "kitchen" }, items))).toContain("Tea Bags");
    expect(names(stockTableRows({ stockArea: "kitchen", includeZeroOnHand: false }, items))).not.toContain("Tea Bags");
    const unknown = { ...items[0], onHand: null };
    expect(stockTableRows({ includeZeroOnHand: false }, [unknown])).toHaveLength(1);
  });

  it("treats an unknown Show value as all items", () => {
    expect(readStockTableConfig({ stockArea: "garage" }).show).toBe("all");
  });
});

describe("answers", () => {
  it("keeps unanswered and an explicit 0 apart and refuses bad values in words", () => {
    expect(readStockUsedValue(undefined)).toEqual({ state: "unanswered" });
    expect(readStockUsedValue("")).toEqual({ state: "unanswered" });
    expect(readStockUsedValue(0)).toEqual({ state: "answered", quantity: 0 });
    expect(readStockUsedValue("3")).toEqual({ state: "answered", quantity: 3 });
    expect(readStockUsedValue(-1)).toEqual({ state: "invalid", message: "cannot be less than 0" });
    expect(readStockUsedValue(1.5)).toEqual({ state: "invalid", message: "must be a whole number of items" });
    expect(readStockUsedValue("two")).toEqual({ state: "invalid", message: "must be a number" });
    expect(readStockUsedValue(100_001).state).toBe("invalid");
  });

  const laundry = { id: "laundry", type: "inventory", label: "Laundry used", stockArea: "laundry", required: true };
  const ids = ["id-DEF-LAUNDRYPOWDER", "id-DEF-LAUNDRYLIQUID"];

  it("requires every shown row when required (0 allowed) and names what is missing", () => {
    expect(stockTableFieldError(laundry, {}, ready)).toBe("Enter how many were used for each item (0 if none). Not answered: Laundry Detergent (Powder), Laundry Liquid.");
    expect(stockTableFieldError(laundry, { [STOCK_TABLE_USAGE_KEY]: { [ids[0]]: 0 } }, ready)).toContain("Not answered: Laundry Liquid.");
    expect(stockTableFieldError(laundry, { [STOCK_TABLE_USAGE_KEY]: { [ids[0]]: 0, [ids[1]]: 2 } }, ready)).toBeNull();
    expect(stockTableFieldError({ ...laundry, required: false }, {}, ready)).toBeNull();
    expect(stockTableFieldError({ ...laundry, required: false }, { [STOCK_TABLE_USAGE_KEY]: { [ids[1]]: -2 } }, ready)).toBe("Laundry Liquid: the amount used cannot be less than 0.");
  });

  it("never blocks on an empty area or an untracked property, and never calls a failed read 'no items'", () => {
    const none: StockTableStock = { status: "ready", tracked: true, items: items.filter((item) => item.area !== "laundry") };
    expect(stockTableFieldError(laundry, {}, none)).toBeNull();
    expect(stockTableFieldError(laundry, {}, { status: "ready", tracked: false, items: [] })).toBeNull();
    expect(stockTableFieldError(laundry, {}, { status: "unavailable", message: "x" })).toBe("The stock list could not be loaded. Try again before submitting.");
    expect(stockTableFieldError(laundry, {}, undefined)).toBeNull();
  });

  it("gives the phone and the server the same verdict through collectFormErrors", () => {
    const schema = section([laundry]);
    const answers = { [STOCK_TABLE_USAGE_KEY]: { [ids[0]]: 1 } };
    const phone = collectFormErrors(schema, answers, {}, {}, undefined, false, undefined, { stockTable: ready });
    const server = collectStockTableErrors(schema, answers, {}, undefined, ready);
    expect(phone).toEqual(server);
    expect(server).toEqual([expect.objectContaining({ fieldId: "laundry", rule: "stock-table", sectionId: "s", sectionLabel: "Rooms" })]);
    // The generic required collector leaves the table to this rule (no answer lives under its id).
    expect(collectRequiredAnswerFields(schema, answers, {})).toEqual([]);
  });

  it("checks only visible tables", () => {
    const hidden = { ...laundry, conditional: { fieldId: "doLaundry", operator: "equals", value: true } };
    expect(collectStockTableErrors(section([{ id: "doLaundry", type: "yesno", label: "Laundry?" }, hidden]), { doLaundry: false }, {}, undefined, ready)).toEqual([]);
  });
});

describe("several tables on one form and the block", () => {
  const kitchen = { id: "k", type: "inventory", label: "Kitchen used", stockArea: "kitchen" };
  const bathroom = { id: "b", type: "inventory", label: "Bathroom used", stockArea: "bathroom" };
  const all = { id: "a", type: "inventory", label: "All used", stockArea: "all" };
  const answers = { [STOCK_TABLE_USAGE_KEY]: { "id-DEF-TP": 3, "id-DEF-COFFEECAPS": 2, "id-DEF-SHAMPOO": 0, "not-shown": 7 } };

  it("shares one answer per item: an item shown twice is deducted once", () => {
    const resolution = resolveStockTableUsage({ schema: section([kitchen, bathroom, all]), answers, property: {} }, items);
    expect(resolution.usage).toEqual({ "id-DEF-TP": 3, "id-DEF-COFFEECAPS": 2 });
    expect(resolution.fields.map((field) => field.fieldId)).toEqual(["k", "b", "a"]);
    expect(resolution.fields[2].rows.find((row) => row.itemId === "id-DEF-TP")?.used).toBe(3);
    expect(resolution.ignoredItemIds).toEqual(["not-shown"]);
  });

  it("lets a table replace the block for the items it shows", () => {
    const resolution = resolveStockTableUsage({ schema: section([bathroom]), answers, property: {} }, items);
    expect(mergeStockUsage({ "id-DEF-TP": 9, "id-DEF-COFFEECAPS": 4, "id-DEF-FOIL": 0 }, resolution)).toEqual({ "id-DEF-COFFEECAPS": 4, "id-DEF-TP": 3 });
    expect(mergeStockUsage(undefined, { usage: {}, coveredItemIds: [] })).toBeUndefined();
    expect(coveredStockItemIds({ schema: section([bathroom]), answers, property: {} }, items).size).toBe(5);
  });

  it("warns (never refuses) about overlapping tables and about the block", () => {
    expect(overlappingStockTables(section([kitchen, bathroom]))).toEqual([]);
    expect(overlappingStockTables(section([kitchen, all])).map((pair) => pair.labels)).toEqual([["Kitchen used", "All used"]]);
    const checks = checkTemplateSchema(section([kitchen, all]));
    expect(checks.errors).toBe(0);
    expect(checks.issues.map((issue) => issue.rule).sort()).toEqual(["stock-table-and-block", "stock-table-overlap"]);
    const noBlock = checkTemplateSchema(section([kitchen], { inventoryConfig: { mode: "selected", itemIds: [] } }));
    expect(noBlock.issues.map((issue) => issue.rule)).toEqual([]);
  });
});

describe("the legacy seed question no longer reads as an error", () => {
  const legacy = section([LEGACY_KITCHEN, LEGACY_BATHROOM], { inventoryConfig: { mode: "selected", itemIds: [] } });

  it("is a registered type with a palette label, icon and description", () => {
    const def = getFieldTypeDef("inventory");
    expect(def).toMatchObject({ label: "Stock used", icon: "PackageMinus", category: "advanced" });
    expect(def?.description).toBeTruthy();
    expect(questionTypeLabel(LEGACY_KITCHEN as never)).toBe("Stock used");
  });

  it("passes the Checks and the strict save check; a bad Show value is refused", () => {
    expect(checkTemplateSchema(legacy).issues.filter((issue) => issue.rule === "unknown-field-type")).toEqual([]);
    expect(checkTemplateSchema(legacy).errors).toBe(0);
    expect(validateFormSchemaForSave(legacy)).toEqual({ ok: true, issues: [] });
    const bad = validateFormSchemaForSave(section([{ id: "x", type: "inventory", label: "Used", stockArea: "garage" }]));
    expect(bad.ok).toBe(false);
    expect(bad.issues[0].message).toContain("unknown area (garage)");
  });

  it("survives normalisation and export / import unchanged", () => {
    const normalized = normalizeFormSchema(legacy) as { sections: Array<{ fields: Array<{ id: string }> }> };
    const kept = normalized.sections.flatMap((entry) => entry.fields).find((field) => field.id === "s4_inventory");
    expect(kept).toMatchObject({ type: "inventory", items: LEGACY_KITCHEN.items });
    const modern = section([{ id: "k", type: "inventory", label: "Kitchen used", stockArea: "kitchen", includeZeroOnHand: false, required: true }]);
    const file = buildExportFile([{ name: "Turnover", serviceType: "AIRBNB_TURNOVER", tags: [], source: "live", sourceVersion: 1, schema: modern }], new Date("2026-11-20T00:00:00Z"));
    const parsed = parseImportFile(JSON.stringify(file), ["AIRBNB_TURNOVER"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.forms[0].refused).toBeNull();
    expect((parsed.forms[0].schema as { sections: Array<{ fields: unknown[] }> }).sections[0].fields[0]).toEqual(modern.sections[0].fields[0]);
  });

  it("formats an old submission's typed text as it was", () => {
    expect(formatFieldValue(LEGACY_KITCHEN as never, "2 tea bags")).toBe("2 tea bags");
    expect(formatFieldValue(LEGACY_KITCHEN as never, undefined)).toBe("-");
  });
});

describe("the office record", () => {
  const data = {
    __stockTable: { fields: [{ fieldId: "b", label: "Bathroom used", show: "bathroom", rows: [
      { itemId: "tp", name: "Toilet paper", unit: "roll", used: 2 },
      { itemId: "soap", name: "Hand soap", unit: "bottle", used: 0 },
      { itemId: "sh", name: "Shampoo", unit: null, used: null },
    ] }] },
  };

  it("reads the server's record per question and renders it readably", () => {
    const entry = stockTableRecordField(data, "b");
    expect(formatStockTableRecord(entry)).toBe("Toilet paper: 2 roll; Hand soap: None used; Shampoo: Not answered");
    expect(stockTableRecordGrid(entry)).toEqual({ columns: ["Item", "Used"], rows: [["Toilet paper", "2 roll"], ["Hand soap", "None used"], ["Shampoo", "Not answered"]] });
  });

  it("returns nothing for older submissions so they keep their previous rendering", () => {
    expect(stockTableRecordField({ inventoryUsage: { tp: 2 } }, "b")).toBeNull();
    expect(stockTableRecordField(null, "b")).toBeNull();
    expect(formatStockTableRecord(null)).toBe("-");
  });
});
