import { describe, it, expect } from "vitest";
import {
  reconcileCountRun,
  shoppingNeedsFromCount,
  type StockLine,
} from "@/lib/inventory/count-run";

const stock = (over: Partial<StockLine> = {}): StockLine => ({
  itemId: "i1",
  itemName: "Bleach",
  onHand: 4,
  parLevel: 6,
  reorderThreshold: 2,
  supplier: "Bunnings",
  unit: "bottle",
  ...over,
});

describe("reconcileCountRun", () => {
  it("replaces the figure rather than adjusting it", () => {
    // A count is a statement about the whole cupboard, not a delta.
    const out = reconcileCountRun({
      stockLines: [stock({ onHand: 4 })],
      scans: [{ itemId: "i1", units: 7 }],
    });
    expect(out.counted[0].countedOnHand).toBe(7);
    expect(out.counted[0].variance).toBe(3);
  });

  it("adds up repeat scans of one item", () => {
    const out = reconcileCountRun({
      stockLines: [stock()],
      scans: [
        { itemId: "i1", units: 2 },
        { itemId: "i1", units: 3 },
      ],
    });
    expect(out.counted[0].countedOnHand).toBe(5);
  });

  it("holds back anything it would zero, instead of just doing it", () => {
    // The whole safeguard: a half-finished run must not silently wipe a shelf.
    const out = reconcileCountRun({
      stockLines: [stock({ itemId: "i1" }), stock({ itemId: "i2", itemName: "Cloths", onHand: 9 })],
      scans: [{ itemId: "i1", units: 5 }],
    });
    expect(out.requiresZeroConfirmation).toBe(true);
    expect(out.wouldZero.map((l) => l.itemId)).toEqual(["i2"]);
    expect(out.wouldZero[0].countedOnHand).toBe(0);
    expect(out.counted.map((l) => l.itemId)).toEqual(["i1"]);
  });

  it("does not warn about something that was already empty", () => {
    // Approving changes nothing for it, and warning anyway trains people to
    // click through the confirmation on the occasion it matters.
    const out = reconcileCountRun({
      stockLines: [stock({ itemId: "i2", onHand: 0 })],
      scans: [],
    });
    expect(out.requiresZeroConfirmation).toBe(false);
    expect(out.wouldZero).toEqual([]);
    expect(out.counted[0].countedOnHand).toBe(0);
  });

  it("lets the cleaner's typed number beat the scanner", () => {
    // They can see a bottle the scanner missed. A system that argues with the
    // person at the cupboard is one they stop using.
    const out = reconcileCountRun({
      stockLines: [stock()],
      scans: [{ itemId: "i1", units: 5 }],
      overrides: { i1: 8 },
    });
    expect(out.counted[0].countedOnHand).toBe(8);
  });

  it("honours an explicit zero as a real answer, not a missed scan", () => {
    const out = reconcileCountRun({
      stockLines: [stock({ onHand: 9 })],
      scans: [],
      overrides: { i1: 0 },
    });
    expect(out.counted[0].countedOnHand).toBe(0);
    // They plainly did not miss it — they typed zero.
    expect(out.wouldZero).toEqual([]);
    expect(out.requiresZeroConfirmation).toBe(false);
  });

  it("ignores a nonsense override rather than writing it", () => {
    const out = reconcileCountRun({
      stockLines: [stock()],
      scans: [{ itemId: "i1", units: 5 }],
      overrides: { i1: -3 },
    });
    expect(out.counted[0].countedOnHand).toBe(5);
  });

  it("keeps unknown barcodes instead of guessing at them", () => {
    const out = reconcileCountRun({
      stockLines: [stock()],
      scans: [{ itemId: "i1", units: 1 }],
      unknown: [{ code: "09300675024235", scans: 4 }],
    });
    expect(out.unknown).toEqual([{ code: "09300675024235", scans: 4 }]);
  });

  it("puts the biggest discrepancy first", () => {
    const out = reconcileCountRun({
      stockLines: [
        stock({ itemId: "a", itemName: "A", onHand: 5 }),
        stock({ itemId: "b", itemName: "B", onHand: 5 }),
      ],
      scans: [
        { itemId: "a", units: 6 },
        { itemId: "b", units: 20 },
      ],
    });
    expect(out.counted[0].itemId).toBe("b");
  });

  it("never proposes a negative amount to buy", () => {
    const out = reconcileCountRun({
      stockLines: [stock({ parLevel: 6 })],
      scans: [{ itemId: "i1", units: 11 }],
    });
    expect(out.counted[0].needed).toBe(0);
  });
});

describe("shoppingNeedsFromCount", () => {
  it("buys what is below par, including what ran out", () => {
    const out = shoppingNeedsFromCount(
      reconcileCountRun({
        stockLines: [
          stock({ itemId: "i1", itemName: "Bleach", parLevel: 6 }),
          stock({ itemId: "i2", itemName: "Cloths", onHand: 3, parLevel: 5 }),
        ],
        scans: [{ itemId: "i1", units: 2 }],
      })
    );
    // Bleach counted 2 of 6 → 4. Cloths unscanned → 0 of 5 → 5.
    expect(out.map((n) => [n.itemId, n.needed])).toEqual([
      ["i2", 5],
      ["i1", 4],
    ]);
  });

  it("leaves out anything already at par", () => {
    // A list padded with zero-quantity rows is one nobody reads to the bottom
    // of, which is how the thing that WAS needed gets missed.
    const out = shoppingNeedsFromCount(
      reconcileCountRun({
        stockLines: [stock({ parLevel: 6 })],
        scans: [{ itemId: "i1", units: 6 }],
      })
    );
    expect(out).toEqual([]);
  });

  it("can be told to ignore items that went to zero", () => {
    // For the case where zero means "not stocked here any more".
    const out = shoppingNeedsFromCount(
      reconcileCountRun({
        stockLines: [stock({ itemId: "i2", onHand: 3, parLevel: 5 })],
        scans: [],
      }),
      { includeZeroed: false }
    );
    expect(out).toEqual([]);
  });

  it("carries the supplier through for grouping", () => {
    const out = shoppingNeedsFromCount(
      reconcileCountRun({ stockLines: [stock({ parLevel: 6 })], scans: [] })
    );
    expect(out[0].supplier).toBe("Bunnings");
    expect(out[0].unit).toBe("bottle");
  });
});
