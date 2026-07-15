import { describe, it, expect } from "vitest";
import {
  sanitizeAccountabilitySettings,
  DEFAULT_ACCOUNTABILITY_SETTINGS,
  type AccountabilitySettings,
} from "@/lib/settings";

const DEF = DEFAULT_ACCOUNTABILITY_SETTINGS;

describe("sanitizeAccountabilitySettings", () => {
  it("round-trips the defaults unchanged", () => {
    const out = sanitizeAccountabilitySettings(DEF, DEF);
    expect(out).toEqual(DEF);
  });

  it("falls back to defaults when input is not an object", () => {
    expect(sanitizeAccountabilitySettings(undefined, DEF)).toBe(DEF);
    expect(sanitizeAccountabilitySettings(null, DEF)).toBe(DEF);
    expect(sanitizeAccountabilitySettings("nope", DEF)).toBe(DEF);
    expect(sanitizeAccountabilitySettings([], DEF)).toBe(DEF);
  });

  it("clamps negative numbers up to 0", () => {
    const out = sanitizeAccountabilitySettings(
      {
        scoring: { minorDeduction: -5, criticalDeduction: -100 },
        bonuses: { streakAmount: -20 },
        rectification: { managerReviewOverMinutes: -30 },
        patternSameCategoryCount: -3,
        patternWindowDays: -1,
      },
      DEF
    );
    expect(out.scoring.minorDeduction).toBe(0);
    expect(out.scoring.criticalDeduction).toBe(0);
    expect(out.bonuses.streakAmount).toBe(0);
    expect(out.rectification.managerReviewOverMinutes).toBe(0);
    expect(out.patternSameCategoryCount).toBe(0);
    expect(out.patternWindowDays).toBe(0);
  });

  it("keeps valid non-negative numeric overrides", () => {
    const out = sanitizeAccountabilitySettings(
      { scoring: { minorDeduction: 7 }, bonuses: { streakLength: 8 } },
      DEF
    );
    expect(out.scoring.minorDeduction).toBe(7);
    expect(out.bonuses.streakLength).toBe(8);
    // Untouched fields keep their fallback values.
    expect(out.scoring.majorDeduction).toBe(DEF.scoring.majorDeduction);
  });

  it("falls back to default bands when bands are empty", () => {
    const out = sanitizeAccountabilitySettings({ rectification: { bands: [] } }, DEF);
    expect(out.rectification.bands).toEqual(DEF.rectification.bands);
  });

  it("falls back to default bands when bands is not an array", () => {
    const out = sanitizeAccountabilitySettings({ rectification: { bands: "nope" } }, DEF);
    expect(out.rectification.bands).toEqual(DEF.rectification.bands);
  });

  it("sorts bands by maxMinutes ascending", () => {
    const out = sanitizeAccountabilitySettings(
      {
        rectification: {
          bands: [
            { maxMinutes: 30, amount: 15 },
            { maxMinutes: 10, amount: 5 },
            { maxMinutes: 20, amount: 10 },
          ],
        },
      },
      DEF
    );
    expect(out.rectification.bands.map((b) => b.maxMinutes)).toEqual([10, 20, 30]);
    expect(out.rectification.bands.map((b) => b.amount)).toEqual([5, 10, 15]);
  });

  it("clamps negative band values to 0 while sorting", () => {
    const out = sanitizeAccountabilitySettings(
      { rectification: { bands: [{ maxMinutes: -5, amount: -2 }] } },
      DEF
    );
    expect(out.rectification.bands).toEqual([{ maxMinutes: 0, amount: 0 }]);
  });

  it("dedupes duplicate issue category keys, keeping the first", () => {
    const out = sanitizeAccountabilitySettings(
      {
        issueCategories: [
          { key: "dusting", label: "Dusting" },
          { key: "dusting", label: "Dusting (dupe)" },
          { key: "rubbish", label: "Rubbish" },
        ],
      },
      DEF
    );
    expect(out.issueCategories).toEqual([
      { key: "dusting", label: "Dusting" },
      { key: "rubbish", label: "Rubbish" },
    ]);
  });

  it("falls back to default categories when the list is empty or invalid", () => {
    expect(sanitizeAccountabilitySettings({ issueCategories: [] }, DEF).issueCategories).toEqual(
      DEF.issueCategories
    );
    expect(
      sanitizeAccountabilitySettings({ issueCategories: [{ label: "no key" }] }, DEF).issueCategories
    ).toEqual(DEF.issueCategories);
  });

  it("defaults a missing category label to its key", () => {
    const out = sanitizeAccountabilitySettings(
      { issueCategories: [{ key: "custom_thing" }] },
      DEF
    );
    expect(out.issueCategories).toEqual([{ key: "custom_thing", label: "custom_thing" }]);
  });

  it("falls back per sub-object when sub-objects are missing", () => {
    const out = sanitizeAccountabilitySettings({ requireJobStartConfirmation: false }, DEF);
    expect(out.scoring).toEqual(DEF.scoring);
    expect(out.bonuses).toEqual(DEF.bonuses);
    expect(out.rectification).toEqual(DEF.rectification);
    expect(out.issueCategories).toEqual(DEF.issueCategories);
    expect(out.requireJobStartConfirmation).toBe(false);
    expect(out.selfInspectionBlocksSubmit).toBe(DEF.selfInspectionBlocksSubmit);
  });

  it("honours boolean overrides", () => {
    const out = sanitizeAccountabilitySettings(
      {
        scoring: { criticalTriggersManagementReview: false },
        rectification: { reworkDeductionsRequireApproval: false },
        requireJobStartConfirmation: false,
        selfInspectionBlocksSubmit: false,
      },
      DEF
    );
    expect(out.scoring.criticalTriggersManagementReview).toBe(false);
    expect(out.rectification.reworkDeductionsRequireApproval).toBe(false);
    expect(out.requireJobStartConfirmation).toBe(false);
    expect(out.selfInspectionBlocksSubmit).toBe(false);
  });
});

// Type-level sanity: the exported shape matches AccountabilitySettings.
const _typecheck: AccountabilitySettings = DEFAULT_ACCOUNTABILITY_SETTINGS;
void _typecheck;
