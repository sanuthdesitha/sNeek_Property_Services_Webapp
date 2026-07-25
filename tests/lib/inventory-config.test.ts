import { describe, expect, it } from "vitest";
import {
  filterStockByConfig,
  normalizeInventoryConfig,
  type InventoryConfig,
} from "@/lib/forms/inventory-config";

const stock = [
  { itemId: "a", item: { id: "a", name: "Toilet paper" } },
  { itemId: "b", item: { id: "b", name: "Dish soap" } },
  { itemId: "c", item: { id: "c", name: "Coffee pods" } },
];

describe("filterStockByConfig", () => {
  it("returns everything when the config is undefined (historic behaviour)", () => {
    expect(filterStockByConfig(stock, undefined)).toEqual(stock);
    expect(filterStockByConfig(stock, null)).toEqual(stock);
  });

  it("returns everything in 'all' mode regardless of itemIds", () => {
    const config: InventoryConfig = { mode: "all", itemIds: ["a"] };
    expect(filterStockByConfig(stock, config)).toEqual(stock);
  });

  it("keeps only the selected items in 'selected' mode", () => {
    const config: InventoryConfig = { mode: "selected", itemIds: ["a", "c"] };
    expect(filterStockByConfig(stock, config).map((r) => r.itemId)).toEqual(["a", "c"]);
  });

  it("ignores unknown ids in the selection", () => {
    const config: InventoryConfig = { mode: "selected", itemIds: ["a", "does-not-exist"] };
    expect(filterStockByConfig(stock, config).map((r) => r.itemId)).toEqual(["a"]);
  });

  it("shows none for an empty selection", () => {
    const config: InventoryConfig = { mode: "selected", itemIds: [] };
    expect(filterStockByConfig(stock, config)).toEqual([]);
  });

  it("matches on the included item.id when the scalar itemId is absent", () => {
    const rows = [{ item: { id: "x" } }, { item: { id: "y" } }];
    const config: InventoryConfig = { mode: "selected", itemIds: ["y"] };
    expect(filterStockByConfig(rows, config)).toEqual([{ item: { id: "y" } }]);
  });

  it("matches on the scalar itemId when item is absent", () => {
    const rows = [{ itemId: "x" }, { itemId: "y" }];
    const config: InventoryConfig = { mode: "selected", itemIds: ["x"] };
    expect(filterStockByConfig(rows, config)).toEqual([{ itemId: "x" }]);
  });
});

describe("normalizeInventoryConfig", () => {
  it("returns undefined for missing/invalid input", () => {
    expect(normalizeInventoryConfig(undefined)).toBeUndefined();
    expect(normalizeInventoryConfig(null)).toBeUndefined();
    expect(normalizeInventoryConfig("all")).toBeUndefined();
    expect(normalizeInventoryConfig([])).toBeUndefined();
    expect(normalizeInventoryConfig({ mode: "banana" })).toBeUndefined();
  });

  it("parses a valid config, deduping and trimming ids", () => {
    expect(
      normalizeInventoryConfig({ mode: "selected", itemIds: [" a ", "a", "b", 3, ""] })
    ).toEqual({ mode: "selected", itemIds: ["a", "b"] });
    expect(normalizeInventoryConfig({ mode: "all" })).toEqual({ mode: "all", itemIds: [] });
  });
});
