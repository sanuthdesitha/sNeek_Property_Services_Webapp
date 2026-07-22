import { describe, it, expect } from "vitest";
import {
  STANDARD_MODULES,
  STANDARD_AIRBNB_ITEMS,
  EXCEPTION_DEFS,
  MODULE_EVIDENCE_CATEGORY,
} from "@/lib/checklists/catalog";
import { CATALOG_VERSION } from "@/lib/checklists/library";

describe("standard Airbnb catalog content (v7)", () => {
  it("bumped the catalog version so seeded databases re-sync", () => {
    expect(CATALOG_VERSION).toBe("7");
  });

  it("declares the wrap-up module", () => {
    expect(STANDARD_MODULES.map((m) => m.key)).toContain("wrap-up");
    expect(MODULE_EVIDENCE_CATEGORY["wrap-up"]).toBe("FINAL");
  });

  it("covers every standard module", () => {
    const modules = new Set(STANDARD_AIRBNB_ITEMS.map((i) => i.moduleKey));
    for (const key of ["kitchen", "bathrooms", "bedrooms", "living", "balcony", "wrap-up"]) {
      expect(modules.has(key)).toBe(true);
    }
  });

  it("has unique, kebab-namespaced item keys", () => {
    const keys = STANDARD_AIRBNB_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
    }
  });

  it("photo-proof items are required with at least one photo and a stamp tag", () => {
    for (const item of STANDARD_AIRBNB_ITEMS) {
      if (item.fieldType !== "photo") continue;
      // Conditional items are revealed on demand, so they are not required.
      if (item.frequency === "CONDITIONAL") continue;
      expect(item.required, `${item.key} should be required`).toBe(true);
      expect(item.minPhotos ?? 0, `${item.key} minPhotos`).toBeGreaterThanOrEqual(1);
      expect(item.stampTag, `${item.key} stampTag`).toBeTruthy();
    }
  });

  it("CONDITIONAL items carry a conditionKey that maps to a known exception", () => {
    const conditional = STANDARD_AIRBNB_ITEMS.filter((i) => i.frequency === "CONDITIONAL");
    expect(conditional.length).toBeGreaterThan(0);
    const exceptionKeys = new Set(EXCEPTION_DEFS.map((d) => d.key));
    for (const item of conditional) {
      expect(item.conditionKey, `${item.key} needs a conditionKey`).toBeTruthy();
      expect(exceptionKeys.has(item.conditionKey!)).toBe(true);
    }
  });

  it("pairs the mould yes/no question with its conditional photo evidence", () => {
    const question = STANDARD_AIRBNB_ITEMS.find((i) => i.key === "bathroom.mould-present");
    const evidence = STANDARD_AIRBNB_ITEMS.find((i) => i.key === "bathroom.mould-treatment");
    expect(question?.fieldType).toBe("yesno");
    expect(evidence?.fieldType).toBe("photo");
    expect(evidence?.frequency).toBe("CONDITIONAL");
    expect(evidence?.conditionKey).toBe("mold");
  });

  it("gates appliance / feature specific items rather than demanding impossible photos", () => {
    const byKey = Object.fromEntries(STANDARD_AIRBNB_ITEMS.map((i) => [i.key, i]));
    expect(byKey["kitchen.dishwasher-in-out"].appliesWhen).toEqual({ feature: "dishwasher" });
    expect(byKey["balcony.overall"].appliesWhen).toEqual({
      propertyField: "hasBalcony",
      equals: true,
    });
    expect(byKey["living.sofa-bed-spare-linen"].appliesWhen).toEqual({
      propertyField: "sofaBedCount",
      operator: "gt",
      equals: 0,
    });
  });

  it("names the under-sink restock contents in its instructions", () => {
    const item = STANDARD_AIRBNB_ITEMS.find((i) => i.key === "kitchen.under-sink-restock");
    const text = item?.instructions.toLowerCase() ?? "";
    for (const needle of [
      "scrubbing pad",
      "dishwashing liquid",
      "dishwasher capsules",
      "microfibre",
      "spray bottle",
      "paper-towel",
    ]) {
      expect(text, `instructions should mention ${needle}`).toContain(needle);
    }
  });

  it("keeps sort orders inside the reserved 300-399 standard band", () => {
    for (const item of STANDARD_AIRBNB_ITEMS) {
      expect(item.sortOrder).toBeGreaterThanOrEqual(300);
      expect(item.sortOrder).toBeLessThan(400);
    }
  });
});
