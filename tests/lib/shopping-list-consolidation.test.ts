import { describe, it, expect } from "vitest";
import { consolidateShoppingListRows } from "@/lib/inventory/shopping-list-report";

/**
 * The adapter deliberately sits ON `getShoppingListRows` rather than beside it.
 * The trigger (onHand <= reorderThreshold) and the quantity (parLevel - onHand)
 * must be computed in ONE place, or the printed sheet and the shopping screen
 * will eventually disagree about what to buy.
 */
const row = (over: Record<string, any> = {}) => ({
  propertyId: "p1",
  propertyName: "Bondi",
  suburb: "Bondi Beach",
  item: {
    id: "i1",
    name: "Bleach",
    sku: null,
    category: "CLEANING",
    unit: "bottle",
    supplier: "Bunnings",
  },
  onHand: 1,
  parLevel: 5,
  reorderThreshold: 2,
  needed: 4,
  ...over,
});

describe("consolidateShoppingListRows", () => {
  it("adds one item across properties and keeps the split", () => {
    const out = consolidateShoppingListRows([
      row({ propertyId: "p1", propertyName: "Bondi", needed: 4 }),
      row({ propertyId: "p2", propertyName: "Coogee", suburb: null, needed: 2 }),
    ]);
    expect(out.consolidated).toHaveLength(1);
    expect(out.consolidated[0].totalNeeded).toBe(6);
    expect(out.consolidated[0].breakdown.map((b) => b.needed)).toEqual([4, 2]);
    expect(out.propertyCount).toBe(2);
  });

  it("puts the suburb in the property label so two 'Mains' are tellable apart", () => {
    const out = consolidateShoppingListRows([row()]);
    expect(out.consolidated[0].breakdown[0].propertyName).toBe("Bondi · Bondi Beach");
  });

  it("drops rows with nothing to buy", () => {
    // getShoppingListRows can return a row at par when the threshold caught it.
    const out = consolidateShoppingListRows([row({ needed: 0 })]);
    expect(out.consolidated).toEqual([]);
    expect(out.propertyCount).toBe(0);
  });

  it("splits into supplier baskets", () => {
    const out = consolidateShoppingListRows([
      row({ item: { ...row().item, id: "i1", supplier: "Bunnings" } }),
      row({ item: { ...row().item, id: "i2", name: "Cloths", supplier: "Coles" } }),
    ]);
    expect(out.baskets.map((b) => b.supplier).sort()).toEqual(["Bunnings", "Coles"]);
  });

  it("has nothing to say about an empty list", () => {
    const out = consolidateShoppingListRows([]);
    expect(out).toEqual({ needs: [], consolidated: [], baskets: [], propertyCount: 0 });
  });
});
