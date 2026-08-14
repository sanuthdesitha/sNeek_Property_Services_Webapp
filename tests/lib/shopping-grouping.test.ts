import { describe, expect, test } from "vitest";
import {
  DEFAULT_SHOPPING_GROUP_MODE,
  UNASSIGNED_SUPPLIER_LABEL,
  groupShoppingRows,
  normalizeShoppingGroupMode,
  type ShoppingGroupableRow,
} from "@/lib/inventory/shopping-grouping";

function row(overrides: Partial<ShoppingGroupableRow> & { itemId: string; propertyId: string }): ShoppingGroupableRow {
  return {
    propertyName: "Property",
    suburb: "Sydney",
    itemName: "Item",
    category: "Cleaning",
    supplier: "Bunnings",
    unit: "bottle",
    plannedQty: 1,
    actualPurchasedQty: 0,
    include: true,
    purchased: false,
    estimatedLineCost: 0,
    actualLineCost: 0,
    ...overrides,
  };
}

/**
 * A two-property run sharing one item, with a second item that only exists at
 * one property and comes from a different supplier. Every grouping assertion
 * below reads off this same fixture.
 */
const RUNS: ShoppingGroupableRow[] = [
  row({
    propertyId: "p-zag",
    propertyName: "ZAG Parramatta",
    suburb: "Parramatta",
    itemId: "i-tp",
    itemName: "Toilet Paper",
    category: "Bathroom",
    supplier: "Costco",
    unit: "roll",
    plannedQty: 12,
    estimatedLineCost: 6,
  }),
  row({
    propertyId: "p-hornsby",
    propertyName: "Hornsby 1BD",
    suburb: "Hornsby",
    itemId: "i-tp",
    itemName: "Toilet Paper",
    category: "Bathroom",
    supplier: "Costco",
    unit: "roll",
    plannedQty: 8,
    purchased: true,
    actualPurchasedQty: 8,
    actualLineCost: 4.5,
    estimatedLineCost: 4,
  }),
  row({
    propertyId: "p-zag",
    propertyName: "ZAG Parramatta",
    suburb: "Parramatta",
    itemId: "i-spray",
    itemName: "Spray n Wipe",
    category: "Cleaning",
    supplier: "Bunnings",
    plannedQty: 2,
    estimatedLineCost: 9,
  }),
];

describe("normalizeShoppingGroupMode", () => {
  test("accepts each of the three supported modes", () => {
    expect(normalizeShoppingGroupMode("property")).toBe("property");
    expect(normalizeShoppingGroupMode("item")).toBe("item");
    expect(normalizeShoppingGroupMode("supplier")).toBe("supplier");
  });

  test("is case and whitespace tolerant", () => {
    expect(normalizeShoppingGroupMode("  SUPPLIER ")).toBe("supplier");
  });

  test("falls back to the default for unknown or non-string input", () => {
    expect(normalizeShoppingGroupMode("category")).toBe(DEFAULT_SHOPPING_GROUP_MODE);
    expect(normalizeShoppingGroupMode(undefined)).toBe(DEFAULT_SHOPPING_GROUP_MODE);
    expect(normalizeShoppingGroupMode(null)).toBe(DEFAULT_SHOPPING_GROUP_MODE);
    expect(normalizeShoppingGroupMode(7)).toBe(DEFAULT_SHOPPING_GROUP_MODE);
  });
});

describe("groupShoppingRows — by property", () => {
  test("gives one group per property, titled and subtitled from the property", () => {
    const groups = groupShoppingRows(RUNS, "property");

    expect(groups.map((g) => g.title)).toEqual(["Hornsby 1BD", "ZAG Parramatta"]);
    expect(groups[0]!.subtitle).toBe("Hornsby");
    expect(groups[0]!.propertyCount).toBe(1);
    expect(groups[1]!.lineCount).toBe(2);
  });

  test("orders rows inside a property by category then item name", () => {
    const groups = groupShoppingRows(RUNS, "property");
    const zag = groups.find((g) => g.title === "ZAG Parramatta")!;

    expect(zag.rows.map((r) => r.itemName)).toEqual(["Toilet Paper", "Spray n Wipe"]);
  });
});

describe("groupShoppingRows — by item", () => {
  test("merges the same item across properties into one group", () => {
    const groups = groupShoppingRows(RUNS, "item");
    const toiletPaper = groups.find((g) => g.title === "Toilet Paper")!;

    expect(groups).toHaveLength(2);
    expect(toiletPaper.lineCount).toBe(2);
    expect(toiletPaper.propertyCount).toBe(2);
    expect(toiletPaper.plannedUnits).toBe(20);
    expect(toiletPaper.subtitle).toBe("Bathroom · per roll · 2 properties");
  });

  test("orders rows inside an item group by property name", () => {
    const groups = groupShoppingRows(RUNS, "item");
    const toiletPaper = groups.find((g) => g.title === "Toilet Paper")!;

    expect(toiletPaper.rows.map((r) => r.propertyName)).toEqual(["Hornsby 1BD", "ZAG Parramatta"]);
  });

  test("groups custom purchases by name, since each one mints a throwaway itemId", () => {
    const custom = [
      row({
        propertyId: "p-zag",
        propertyName: "ZAG Parramatta",
        itemId: "custom:aaaa",
        itemName: "Light bulb",
        isCustom: true,
      }),
      row({
        propertyId: "p-hornsby",
        propertyName: "Hornsby 1BD",
        itemId: "custom:bbbb",
        itemName: "light bulb",
        isCustom: true,
      }),
    ];

    const groups = groupShoppingRows(custom, "item");

    expect(groups).toHaveLength(1);
    expect(groups[0]!.lineCount).toBe(2);
  });
});

describe("groupShoppingRows — by supplier", () => {
  test("gives one group per supplier, sorted by supplier name", () => {
    const groups = groupShoppingRows(RUNS, "supplier");

    expect(groups.map((g) => g.title)).toEqual(["Bunnings", "Costco"]);
    expect(groups[1]!.lineCount).toBe(2);
    expect(groups[1]!.subtitle).toBe("2 lines · 2 properties");
  });

  test("folds supplier names on case and spacing", () => {
    const groups = groupShoppingRows(
      [
        row({ propertyId: "p-1", itemId: "i-1", supplier: "Bunnings" }),
        row({ propertyId: "p-2", itemId: "i-2", supplier: "  bunnings " }),
      ],
      "supplier"
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.lineCount).toBe(2);
  });

  test("buckets missing suppliers under a single unassigned group", () => {
    const groups = groupShoppingRows(
      [
        row({ propertyId: "p-1", itemId: "i-1", supplier: null }),
        row({ propertyId: "p-2", itemId: "i-2", supplier: "   " }),
      ],
      "supplier"
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe(UNASSIGNED_SUPPLIER_LABEL);
  });
});

describe("groupShoppingRows — totals and safety", () => {
  test("excluded lines do not count towards planned units", () => {
    const groups = groupShoppingRows(
      [
        row({ propertyId: "p-1", itemId: "i-1", plannedQty: 5, include: true }),
        row({ propertyId: "p-1", itemId: "i-2", plannedQty: 7, include: false }),
      ],
      "property"
    );

    expect(groups[0]!.plannedUnits).toBe(5);
    expect(groups[0]!.lineCount).toBe(2);
  });

  test("only purchased lines contribute purchased units and counts", () => {
    const groups = groupShoppingRows(RUNS, "property");
    const hornsby = groups.find((g) => g.title === "Hornsby 1BD")!;
    const zag = groups.find((g) => g.title === "ZAG Parramatta")!;

    expect(hornsby.purchasedUnits).toBe(8);
    expect(hornsby.purchasedLineCount).toBe(1);
    expect(zag.purchasedUnits).toBe(0);
    expect(zag.purchasedLineCount).toBe(0);
  });

  test("money totals are rounded to cents rather than left as float noise", () => {
    const groups = groupShoppingRows(
      [
        row({ propertyId: "p-1", itemId: "i-1", actualLineCost: 0.1, purchased: true }),
        row({ propertyId: "p-1", itemId: "i-2", actualLineCost: 0.2, purchased: true }),
      ],
      "property"
    );

    expect(groups[0]!.actualCost).toBe(0.3);
  });

  test("treats null and undefined numerics as zero instead of NaN", () => {
    const groups = groupShoppingRows(
      [row({ propertyId: "p-1", itemId: "i-1", plannedQty: null, estimatedLineCost: null })],
      "property"
    );

    expect(groups[0]!.plannedUnits).toBe(0);
    expect(groups[0]!.estimatedCost).toBe(0);
  });

  test("does not mutate the input array or reorder it in place", () => {
    const input = [...RUNS];
    const snapshot = input.map((r) => `${r.propertyId}:${r.itemId}`);

    groupShoppingRows(input, "item");

    expect(input.map((r) => `${r.propertyId}:${r.itemId}`)).toEqual(snapshot);
  });

  test("keeps row identity so callers can write back by itemId + propertyId", () => {
    const groups = groupShoppingRows(RUNS, "supplier");
    const allRows = groups.flatMap((g) => g.rows);

    expect(allRows).toHaveLength(RUNS.length);
    for (const original of RUNS) expect(allRows).toContain(original);
  });

  test("returns an empty list for no rows", () => {
    expect(groupShoppingRows([], "property")).toEqual([]);
  });

  test("normalises an invalid mode rather than throwing", () => {
    const groups = groupShoppingRows(RUNS, "nonsense" as never);

    expect(groups.map((g) => g.title)).toEqual(["Hornsby 1BD", "ZAG Parramatta"]);
  });
});
