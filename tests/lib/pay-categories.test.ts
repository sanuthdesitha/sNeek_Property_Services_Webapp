import { describe, expect, it } from "vitest";
import {
  PAY_ADJUSTMENT_CATEGORIES,
  PAY_ADJUSTMENT_CATEGORY_VALUES,
  isTaxableCategory,
  payCategoryLabel,
} from "@/lib/finance/pay-categories";

describe("pay adjustment categories", () => {
  it("treats work as taxable and out-of-pocket money as not", () => {
    expect(isTaxableCategory("SERVICE")).toBe(true);
    expect(isTaxableCategory("PARKING")).toBe(false);
    expect(isTaxableCategory("REIMBURSEMENT")).toBe(false);
  });

  it("defaults an absent category to taxable", () => {
    // Every row written before the split was work, and every row written by a
    // caller that doesn't know about categories still is.
    expect(isTaxableCategory(undefined)).toBe(true);
    expect(isTaxableCategory(null)).toBe(true);
    expect(isTaxableCategory("")).toBe(true);
  });

  it("treats an UNKNOWN category as taxable rather than as a refund", () => {
    // Guessing "reimbursement" for something we don't recognise would shrink
    // someone's declared earnings without anyone choosing that.
    expect(isTaxableCategory("SOMETHING_NEW")).toBe(true);
  });

  it("exposes every category value for zod enums", () => {
    expect(PAY_ADJUSTMENT_CATEGORY_VALUES).toEqual(
      PAY_ADJUSTMENT_CATEGORIES.map((c) => c.value)
    );
    expect(PAY_ADJUSTMENT_CATEGORY_VALUES.length).toBeGreaterThan(0);
  });

  it("labels known categories and falls back to the raw value", () => {
    expect(payCategoryLabel("PARKING")).toBe("Parking");
    expect(payCategoryLabel(null)).toBe("Work / service");
    expect(payCategoryLabel("LEGACY_THING")).toBe("LEGACY_THING");
  });

  it("gives every category a hint, since the choice changes the invoice", () => {
    for (const option of PAY_ADJUSTMENT_CATEGORIES) {
      expect(option.hint.trim().length).toBeGreaterThan(0);
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
  });
});
