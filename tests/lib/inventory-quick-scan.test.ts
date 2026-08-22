import { describe, it, expect } from "vitest";
import {
  applyQuickScan,
  modeWrites,
  modeNeedsQuantity,
  quickScanNote,
} from "@/lib/inventory/quick-scan";
import {
  generateLabelCode,
  normalizeLabelCode,
  isLabelCode,
  labelCaption,
  LABEL_PREFIX,
} from "@/lib/inventory/label-codes";

describe("applyQuickScan", () => {
  it("adds one per scan by default", () => {
    const out = applyQuickScan({ mode: "INCREMENT", currentOnHand: 4 });
    expect(out.nextOnHand).toBe(5);
    expect(out.delta).toBe(1);
  });

  it("adds a whole carton when the barcode is a carton", () => {
    // Same rule the count run uses — a carton is a carton whichever screen
    // you are on.
    const out = applyQuickScan({ mode: "INCREMENT", currentOnHand: 0, step: 12 });
    expect(out.nextOnHand).toBe(12);
  });

  it("takes one away in remove mode", () => {
    expect(applyQuickScan({ mode: "DECREMENT", currentOnHand: 3 }).nextOnHand).toBe(2);
  });

  it("refuses to go below zero rather than clamping", () => {
    // Clamping would silently record a smaller decrement than the cleaner
    // performed, surfacing later as unexplained shrinkage.
    const out = applyQuickScan({ mode: "DECREMENT", currentOnHand: 0 });
    expect(out.error).toBe("NEGATIVE_STOCK");
    expect(out.nextOnHand).toBe(0);
    expect(out.delta).toBe(0);
  });

  it("changes nothing in check mode", () => {
    const out = applyQuickScan({ mode: "SHOW", currentOnHand: 7 });
    expect(out.nextOnHand).toBe(7);
    expect(out.delta).toBe(0);
    expect(out.noop).toBe(true);
    expect(modeWrites("SHOW")).toBe(false);
  });

  it("sets an exact figure and reports the difference", () => {
    const out = applyQuickScan({ mode: "SET", currentOnHand: 4, quantity: 9 });
    expect(out.nextOnHand).toBe(9);
    expect(out.delta).toBe(5);
  });

  it("treats setting a shelf to what it already holds as no edit", () => {
    // A zero-delta ledger line records nothing happening.
    const out = applyQuickScan({ mode: "SET", currentOnHand: 4, quantity: 4 });
    expect(out.noop).toBe(true);
    expect(out.delta).toBe(0);
  });

  it("insists on a number for set and move", () => {
    expect(modeNeedsQuantity("SET")).toBe(true);
    expect(modeNeedsQuantity("TRANSFER")).toBe(true);
    expect(applyQuickScan({ mode: "SET", currentOnHand: 1 }).error).toBe("QUANTITY_REQUIRED");
  });

  it("moves stock out of the source property", () => {
    const out = applyQuickScan({
      mode: "TRANSFER",
      currentOnHand: 10,
      quantity: 3,
      fromPropertyId: "p1",
      toPropertyId: "p2",
    });
    expect(out.nextOnHand).toBe(7);
    expect(out.delta).toBe(-3);
  });

  it("will not send more than is on the shelf", () => {
    // Otherwise the source goes negative and the destination gains stock that
    // never existed.
    const out = applyQuickScan({
      mode: "TRANSFER",
      currentOnHand: 2,
      quantity: 5,
      fromPropertyId: "p1",
      toPropertyId: "p2",
    });
    expect(out.error).toBe("NEGATIVE_STOCK");
  });

  it("will not move stock to where it already is", () => {
    const out = applyQuickScan({
      mode: "TRANSFER",
      currentOnHand: 5,
      quantity: 1,
      fromPropertyId: "p1",
      toPropertyId: "p1",
    });
    expect(out.error).toBe("SAME_PROPERTY");
  });
});

describe("quickScanNote", () => {
  it("explains itself in the ledger", () => {
    expect(quickScanNote({ mode: "INCREMENT", previous: 2, next: 3 })).toContain("2 → 3");
  });

  it("names the destination on a move", () => {
    const note = quickScanNote({ mode: "TRANSFER", previous: 5, next: 2, toPropertyName: "Coogee" });
    expect(note).toContain("Coogee");
  });
});

describe("label codes", () => {
  it("mints a code with our prefix and a fixed length", () => {
    const code = generateLabelCode(() => 0);
    expect(code.startsWith(LABEL_PREFIX)).toBe(true);
    expect(code).toHaveLength(LABEL_PREFIX.length + 8);
  });

  it("never emits characters people confuse reading a label aloud", () => {
    // No O/0 or I/1 ambiguity.
    for (let i = 0; i < 200; i += 1) {
      const body = generateLabelCode().slice(LABEL_PREFIX.length);
      expect(body).not.toMatch(/[OILU]/);
    }
  });

  it("survives a random() that returns exactly 1", () => {
    // An out-of-range index would produce undefined and silently shorten the
    // code, which would then collide with other shortened codes.
    const code = generateLabelCode(() => 1);
    expect(code).toHaveLength(LABEL_PREFIX.length + 8);
    expect(code).not.toContain("undefined");
  });

  it("accepts a code typed back without the hyphen or in lower case", () => {
    const code = generateLabelCode(() => 0.5);
    const body = code.slice(LABEL_PREFIX.length);
    expect(normalizeLabelCode(`snk${body.toLowerCase()}`)).toBe(code);
    expect(normalizeLabelCode(` ${code} `)).toBe(code);
  });

  it("rejects anything that is not one of ours", () => {
    // A manufacturer GTIN must fall through to the product-barcode path.
    expect(normalizeLabelCode("9300675024235")).toBeNull();
    expect(normalizeLabelCode("SNK-TOOSHORT")).toBeNull();
    expect(isLabelCode("SNK-OOOOOOOO")).toBe(false); // O is not in the alphabet
    expect(isLabelCode(null)).toBe(false);
  });

  it("captions a label so a human can use it without a scanner", () => {
    expect(labelCaption({ code: "x", itemName: "Bleach", propertyName: "Bondi" })).toContain("Bondi");
    expect(labelCaption({ code: "x", itemName: "Bleach" })).toContain("Any property");
  });
});
