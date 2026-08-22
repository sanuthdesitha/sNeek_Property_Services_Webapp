import { describe, it, expect } from "vitest";
import {
  consolidateShoppingNeeds,
  basketsBySupplier,
  NO_SUPPLIER_LABEL,
  type PropertyNeed,
} from "@/lib/inventory/shopping-consolidation";

const need = (over: Partial<PropertyNeed> = {}): PropertyNeed => ({
  propertyId: "p1",
  propertyName: "Bondi",
  itemId: "i1",
  itemName: "Bleach",
  needed: 4,
  supplier: "Bunnings",
  unit: "bottle",
  ...over,
});

describe("consolidateShoppingNeeds", () => {
  it("gives one quantity to buy and the split to drop", () => {
    // The shopper needs six. The driver needs four-and-two.
    const [line] = consolidateShoppingNeeds([
      need({ propertyId: "p1", propertyName: "Bondi", needed: 4 }),
      need({ propertyId: "p2", propertyName: "Coogee", needed: 2 }),
    ]);
    expect(line.totalNeeded).toBe(6);
    expect(line.propertyCount).toBe(2);
    expect(line.breakdown).toEqual([
      { propertyId: "p1", propertyName: "Bondi", needed: 4 },
      { propertyId: "p2", propertyName: "Coogee", needed: 2 },
    ]);
  });

  it("sums a property that asks twice rather than taking the larger", () => {
    // Discarding the second request loses a real one. If the duplication is a
    // mistake, an over-buy is visible on the shelf and a short-buy is not.
    const [line] = consolidateShoppingNeeds([
      need({ needed: 4 }),
      need({ needed: 3 }),
    ]);
    expect(line.totalNeeded).toBe(7);
    expect(line.propertyCount).toBe(1);
    expect(line.breakdown[0].needed).toBe(7);
  });

  it("keeps different items apart", () => {
    const out = consolidateShoppingNeeds([
      need({ itemId: "i1", itemName: "Bleach", needed: 2 }),
      need({ itemId: "i2", itemName: "Cloths", needed: 9 }),
    ]);
    expect(out).toHaveLength(2);
    // Most-wanted first.
    expect(out[0].itemId).toBe("i2");
  });

  it("drops zero and nonsense quantities", () => {
    const out = consolidateShoppingNeeds([
      need({ needed: 0 }),
      need({ itemId: "i2", needed: -3 }),
      need({ itemId: "i3", needed: Number.NaN }),
    ]);
    expect(out).toEqual([]);
  });

  it("picks up a supplier a later property knows about", () => {
    // The first property to want an item is not necessarily the one with the
    // supplier filled in.
    const [line] = consolidateShoppingNeeds([
      need({ propertyId: "p1", supplier: null }),
      need({ propertyId: "p2", propertyName: "Coogee", supplier: "Coles" }),
    ]);
    expect(line.supplier).toBe("Coles");
  });

  it("puts the biggest drop first in the breakdown", () => {
    const [line] = consolidateShoppingNeeds([
      need({ propertyId: "p1", propertyName: "Bondi", needed: 1 }),
      need({ propertyId: "p2", propertyName: "Coogee", needed: 8 }),
    ]);
    expect(line.breakdown[0].propertyName).toBe("Coogee");
  });

  it("has nothing to say about nothing", () => {
    expect(consolidateShoppingNeeds([])).toEqual([]);
  });
});

describe("basketsBySupplier", () => {
  it("makes one basket per shop", () => {
    const lines = consolidateShoppingNeeds([
      need({ itemId: "i1", supplier: "Bunnings", needed: 4 }),
      need({ itemId: "i2", itemName: "Cloths", supplier: "Coles", needed: 2 }),
      need({ itemId: "i3", itemName: "Spray", supplier: "Bunnings", needed: 1 }),
    ]);
    const baskets = basketsBySupplier(lines);
    expect(baskets[0].supplier).toBe("Bunnings");
    expect(baskets[0].itemCount).toBe(2);
    expect(baskets[0].totalUnits).toBe(5);
  });

  it("keeps items with no supplier instead of hiding them", () => {
    // They still have to be bought. Hiding them because a field is blank is
    // how a shop trip comes back incomplete.
    const lines = consolidateShoppingNeeds([
      need({ itemId: "i1", supplier: "Bunnings" }),
      need({ itemId: "i2", itemName: "Mystery", supplier: null }),
    ]);
    const baskets = basketsBySupplier(lines);
    expect(baskets.map((b) => b.supplier)).toContain(NO_SUPPLIER_LABEL);
  });

  it("sorts the unassigned pile last — it is a loose end, not a shop", () => {
    const lines = consolidateShoppingNeeds([
      need({ itemId: "i1", supplier: null, needed: 99 }),
      need({ itemId: "i2", itemName: "Cloths", supplier: "Aldi", needed: 1 }),
    ]);
    const baskets = basketsBySupplier(lines);
    expect(baskets[baskets.length - 1].supplier).toBe(NO_SUPPLIER_LABEL);
  });

  it("treats a blank supplier string the same as none", () => {
    const lines = consolidateShoppingNeeds([need({ supplier: "   " })]);
    expect(basketsBySupplier(lines)[0].supplier).toBe(NO_SUPPLIER_LABEL);
  });
});
