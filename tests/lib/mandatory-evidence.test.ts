import { describe, it, expect } from "vitest";
import { MANDATORY_EVIDENCE_ITEMS } from "@/lib/checklists/catalog";

/**
 * Pure (no-DB) guards over the granular mandatory-every-clean evidence set. The
 * library seed loop stamps these `frequency: "EVERY_CLEAN"` and homes them on
 * their `moduleKey` module; these assertions lock the authored content shape.
 */
describe("MANDATORY_EVIDENCE_ITEMS", () => {
  const byKey = (k: string) => MANDATORY_EVIDENCE_ITEMS.find((i) => i.key === k);

  it("covers all eight evidence categories", () => {
    const expected = [
      "PROPERTY_CONFIRM",
      "LAUNDRY_CONFIRM",
      "LIVING",
      "KITCHEN",
      "BATHROOM",
      "BEDROOM",
      "OUTDOOR",
      "FINAL",
    ];
    const seen = new Set(MANDATORY_EVIDENCE_ITEMS.map((i) => i.evidenceCategory));
    for (const cat of expected) expect(seen.has(cat)).toBe(true);
    // No stray categories beyond the eight.
    expect(seen.size).toBe(expected.length);
  });

  it("is a photo, single-photo, AIRBNB_TURNOVER evidence set throughout", () => {
    for (const item of MANDATORY_EVIDENCE_ITEMS) {
      expect(item.fieldType).toBe("photo");
      expect(item.minPhotos).toBeGreaterThanOrEqual(1);
      expect(item.jobTypes ?? []).toContain("AIRBNB_TURNOVER");
    }
  });

  it("uses unique keys", () => {
    const keys = MANDATORY_EVIDENCE_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gates the sofa-bed supplies item on sofaBedCount > 0", () => {
    const sofa = byKey("ev.living.sofabed-supplies");
    expect(sofa?.appliesWhen).toEqual({
      propertyField: "sofaBedCount",
      operator: "gt",
      equals: 0,
    });
  });

  it("gates coffee / dishwasher / fridge items on their features", () => {
    expect(byKey("ev.kitchen.coffee-filter")?.appliesWhen).toEqual({ feature: "coffeeMachine" });
    expect(byKey("ev.kitchen.capsules-removed")?.appliesWhen).toEqual({ feature: "coffeeMachine" });
    expect(byKey("ev.kitchen.dishwasher-empty")?.appliesWhen).toEqual({ feature: "dishwasher" });
    expect(byKey("ev.kitchen.fridge-empty")?.appliesWhen).toEqual({ feature: "fridge" });
  });

  it("homes the balcony items on the balcony module", () => {
    const balcony = MANDATORY_EVIDENCE_ITEMS.filter((i) => i.key.startsWith("ev.balcony."));
    expect(balcony.length).toBeGreaterThan(0);
    for (const item of balcony) {
      expect(item.moduleKey).toBe("balcony");
      expect(item.evidenceCategory).toBe("OUTDOOR");
    }
  });

  it("leaves every ungated item without an appliesWhen rule", () => {
    const gated = new Set([
      "ev.living.sofabed-supplies",
      "ev.kitchen.coffee-filter",
      "ev.kitchen.capsules-removed",
      "ev.kitchen.dishwasher-empty",
      "ev.kitchen.fridge-empty",
    ]);
    for (const item of MANDATORY_EVIDENCE_ITEMS) {
      if (gated.has(item.key)) continue;
      expect(item.appliesWhen ?? null).toBeNull();
    }
  });
});
