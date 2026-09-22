import { expect, it } from "vitest";
import { groupHeldStock } from "@/lib/inventory/held-stock-grouping";
const item = { id: "soap", name: "Soap", unit: "bottle", category: "Cleaning" };
it("combines repeated additions while preserving editable source entries", () => {
  const rows = [{ id: "one", item, quantity: 3 }, { id: "two", item, quantity: 4 }];
  expect(groupHeldStock(rows)).toEqual([{ key: JSON.stringify(["soap", "bottle"]), item, category: "Cleaning", quantity: 7, entries: rows }]);
});
it("keeps different items and units separate within the same category", () => {
  expect(groupHeldStock([{ id: "a", item, quantity: 2 }, { id: "b", item: { ...item, id: "detergent" }, quantity: 3 }, { id: "c", item: { ...item, unit: "litre" }, quantity: 1 }])).toHaveLength(3);
});
it("keeps unknown items separate and retains zero entries for corrections", () => {
  const groups = groupHeldStock([{ id: "a", item: null, quantity: 0 }, { id: "b", item: null, quantity: 2 }]);
  expect(groups).toHaveLength(2); expect(groups[0].quantity).toBe(0);
});
