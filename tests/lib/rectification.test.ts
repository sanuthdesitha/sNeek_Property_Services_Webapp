import { describe, it, expect } from "vitest";
import {
  resolveRectificationBand,
  buildRectificationSourceKey,
  buildReworkDeductionSourceKey,
} from "@/lib/accountability/rectification";
import { ratingForScore } from "@/lib/accountability/scoring";
import { DEFAULT_ACCOUNTABILITY_SETTINGS } from "@/lib/settings";
import type { AccountabilityRectificationSettings } from "@/lib/settings";

const RECT = DEFAULT_ACCOUNTABILITY_SETTINGS.rectification;
const SCORING = DEFAULT_ACCOUNTABILITY_SETTINGS.scoring;

describe("resolveRectificationBand", () => {
  it("5 min → $5 (first band)", () => {
    expect(resolveRectificationBand(5, RECT)).toEqual({ amount: 5, requiresManagerReview: false });
  });

  it("10 min → $5 (band boundary, inclusive)", () => {
    expect(resolveRectificationBand(10, RECT)).toEqual({ amount: 5, requiresManagerReview: false });
  });

  it("11 min → $10 (second band)", () => {
    expect(resolveRectificationBand(11, RECT)).toEqual({ amount: 10, requiresManagerReview: false });
  });

  it("20 min → $10 (second band boundary)", () => {
    expect(resolveRectificationBand(20, RECT)).toEqual({ amount: 10, requiresManagerReview: false });
  });

  it("25 min → $15 (third band)", () => {
    expect(resolveRectificationBand(25, RECT)).toEqual({ amount: 15, requiresManagerReview: false });
  });

  it("30 min → $15 (third band boundary = manager threshold, not over)", () => {
    expect(resolveRectificationBand(30, RECT)).toEqual({ amount: 15, requiresManagerReview: false });
  });

  it("31 min → manager review, $0", () => {
    expect(resolveRectificationBand(31, RECT)).toEqual({ amount: 0, requiresManagerReview: true });
  });

  it("0 min → $5 (first band)", () => {
    expect(resolveRectificationBand(0, RECT)).toEqual({ amount: 5, requiresManagerReview: false });
  });

  it("handles unsorted bands", () => {
    const unsorted: AccountabilityRectificationSettings = {
      bands: [
        { maxMinutes: 30, amount: 15 },
        { maxMinutes: 10, amount: 5 },
        { maxMinutes: 20, amount: 10 },
      ],
      managerReviewOverMinutes: 30,
      reworkDeductionsRequireApproval: true,
    };
    expect(resolveRectificationBand(5, unsorted).amount).toBe(5);
    expect(resolveRectificationBand(15, unsorted).amount).toBe(10);
    expect(resolveRectificationBand(25, unsorted).amount).toBe(15);
    expect(resolveRectificationBand(31, unsorted).requiresManagerReview).toBe(true);
  });

  it("beyond last band but under manager threshold → manager review", () => {
    // Last band maxMinutes 30 but manager threshold 40; 35 falls past the bands.
    const cfg: AccountabilityRectificationSettings = {
      bands: [
        { maxMinutes: 10, amount: 5 },
        { maxMinutes: 20, amount: 10 },
        { maxMinutes: 30, amount: 15 },
      ],
      managerReviewOverMinutes: 40,
      reworkDeductionsRequireApproval: true,
    };
    expect(resolveRectificationBand(35, cfg)).toEqual({ amount: 0, requiresManagerReview: true });
  });
});

describe("source key builders", () => {
  it("buildRectificationSourceKey", () => {
    expect(buildRectificationSourceKey("abc123")).toBe("rect:abc123");
  });

  it("buildReworkDeductionSourceKey", () => {
    expect(buildReworkDeductionSourceKey("job789")).toBe("rework:job789");
  });
});

describe("ratingForScore", () => {
  // Defaults: excellentMin 97, passMin 93, needsImprovementMin 85.
  it("100 → EXCELLENT", () => {
    expect(ratingForScore(100, SCORING, false)).toBe("EXCELLENT");
  });

  it("97 → EXCELLENT (boundary)", () => {
    expect(ratingForScore(97, SCORING, false)).toBe("EXCELLENT");
  });

  it("96 → PASS (just below excellent)", () => {
    expect(ratingForScore(96, SCORING, false)).toBe("PASS");
  });

  it("93 → PASS (boundary)", () => {
    expect(ratingForScore(93, SCORING, false)).toBe("PASS");
  });

  it("92 → NEEDS_IMPROVEMENT (just below pass)", () => {
    expect(ratingForScore(92, SCORING, false)).toBe("NEEDS_IMPROVEMENT");
  });

  it("85 → NEEDS_IMPROVEMENT (boundary)", () => {
    expect(ratingForScore(85, SCORING, false)).toBe("NEEDS_IMPROVEMENT");
  });

  it("84 → FAILED (just below needs-improvement)", () => {
    expect(ratingForScore(84, SCORING, false)).toBe("FAILED");
  });

  it("hasCritical overrides a perfect score → MANAGEMENT_REVIEW", () => {
    expect(ratingForScore(100, SCORING, true)).toBe("MANAGEMENT_REVIEW");
  });

  it("hasCritical does not override when the setting is off", () => {
    const off = { ...SCORING, criticalTriggersManagementReview: false };
    expect(ratingForScore(100, off, true)).toBe("EXCELLENT");
  });
});
