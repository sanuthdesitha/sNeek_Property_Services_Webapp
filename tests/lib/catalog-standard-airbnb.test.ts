import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHECKLISTS,
  FEATURE_MODULES,
  ROTATIONAL_EVIDENCE_ITEMS,
  MANDATORY_EVIDENCE_ITEMS,
  EXCEPTION_MODULE,
  SELF_INSPECTION_MODULE,
  STANDARD_MODULES,
  STANDARD_AIRBNB_ITEMS,
  EXCEPTION_DEFS,
  MODULE_EVIDENCE_CATEGORY,
} from "@/lib/checklists/catalog";
import { CATALOG_VERSION } from "@/lib/checklists/library";

/**
 * The full standard set, after de-duplication against the `ev.*` mandatory
 * evidence library. Anything an `ev.*` item already photographs must NOT appear
 * here — otherwise a cleaner shoots two photos of the same subject per property.
 */
const SURVIVING_KEYS = [
  "kitchen.microwave-in-out",
  "kitchen.oven-in-out",
  "kitchen.toaster-crumb-tray",
  "kitchen.bins-emptied",
  "bathroom.mould-treatment",
  "bathroom.spare-toilet-paper",
  "bathroom.bins-emptied",
  "living.tv-working",
  "wrap-up.vacuum-emptied",
  "wrap-up.laundry-bag-staged",
  "wrap-up.outside-bins-entrance",
  "wrap-up.cleaners-cupboard-locked",
  "wrap-up.lock-up-video",
] as const;

/**
 * Regression guard. Each of these standard keys once existed and duplicated the
 * `ev.*` item it maps to. They were removed; none may come back.
 */
const FORBIDDEN_DUPLICATE_PAIRS: Record<string, string> = {
  "kitchen.overall": "ev.kitchen.kitchen-wide",
  "kitchen.under-sink-restock": "ev.kitchen.under-sink",
  "kitchen.fridge-in-out": "ev.kitchen.fridge-empty",
  "kitchen.dishwasher-in-out": "ev.kitchen.dishwasher-empty",
  "kitchen.inside-cupboards": "ev.kitchen.cupboards-organised",
  "kitchen.coffee-machine-emptied": "ev.kitchen.coffee-filter",
  "kitchen.kettle-empty": "ev.kitchen.kettle-empty",
  "bathroom.overall": "ev.bathrooms.bathroom-wide",
  "bathroom.shower-walls-scrubbed": "ev.bathrooms.shower-walls",
  "bathroom.basin-toilet": "ev.bathrooms.toilet-base",
  "bathroom.mould-present": "ev.bathrooms.mold-hair",
  "bathroom.amenity-refills": "ev.bathrooms.bodywash-level",
  "bedroom.overall-beds": "ev.bedrooms.bedroom-wide",
  "bedroom.under-beds": "ev.bedrooms.under-bed-floor",
  "bedroom.inside-wardrobes": "ev.bedrooms.wardrobe-interior",
  "bedroom.bedside-tables": "ev.bedrooms.bedside-area",
  "living.overall": "ev.living.living-wide",
  "living.sofa-bed-spare-linen": "ev.living.sofabed-supplies",
};

/** Every item key the catalog defines OUTSIDE of STANDARD_AIRBNB_ITEMS. */
function otherCatalogKeys(): Set<string> {
  const keys = new Set<string>();
  for (const checklist of Object.values(DEFAULT_CHECKLISTS)) {
    for (const section of checklist.sections) {
      for (const item of section.items) keys.add(item.id);
    }
  }
  for (const mod of FEATURE_MODULES) for (const item of mod.items) keys.add(item.key);
  for (const item of ROTATIONAL_EVIDENCE_ITEMS) keys.add(item.key);
  for (const item of MANDATORY_EVIDENCE_ITEMS) keys.add(item.key);
  for (const item of EXCEPTION_MODULE.items) keys.add(item.key);
  for (const item of SELF_INSPECTION_MODULE.items) keys.add(item.key);
  return keys;
}

describe("standard Airbnb catalog content (v7)", () => {
  it("bumped the catalog version so seeded databases re-sync", () => {
    expect(CATALOG_VERSION).toBe("7");
  });

  it("declares the wrap-up module", () => {
    expect(STANDARD_MODULES.map((m) => m.key)).toContain("wrap-up");
    expect(MODULE_EVIDENCE_CATEGORY["wrap-up"]).toBe("FINAL");
  });

  it("is exactly the deduped standard set", () => {
    expect(STANDARD_AIRBNB_ITEMS.map((i) => i.key)).toEqual([...SURVIVING_KEYS]);
  });

  it("homes items only on modules that exist", () => {
    const modules = new Set(STANDARD_AIRBNB_ITEMS.map((i) => i.moduleKey));
    expect([...modules].sort()).toEqual([
      "bathrooms",
      "kitchen",
      "living",
      "wrap-up",
    ]);
    // The wrap-up module is declared by us; the rest are base catalog modules.
    for (const key of modules) {
      if (STANDARD_MODULES.some((m) => m.key === key)) continue;
      expect(MODULE_EVIDENCE_CATEGORY[key], `${key} should be a known module`).toBeTruthy();
    }
  });

  it("has unique, kebab-namespaced item keys", () => {
    const keys = STANDARD_AIRBNB_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9-]+\.[a-z0-9-]+$/);
    }
  });

  // ── The point of the de-duplication ─────────────────────────────────────
  it("never re-introduces a standard item that duplicates an ev.* evidence item", () => {
    const standardKeys = new Set(STANDARD_AIRBNB_ITEMS.map((i) => i.key));
    const evidenceKeys = new Set(MANDATORY_EVIDENCE_ITEMS.map((i) => i.key));
    for (const [standardKey, evKey] of Object.entries(FORBIDDEN_DUPLICATE_PAIRS)) {
      // The ev.* item is the single source of truth for this subject…
      expect(evidenceKeys.has(evKey), `${evKey} should exist in MANDATORY_EVIDENCE_ITEMS`).toBe(
        true,
      );
      // …so the standard set must not ask for the same photo again.
      expect(
        standardKeys.has(standardKey),
        `${standardKey} duplicates ${evKey} — cleaners would shoot the same photo twice`,
      ).toBe(false);
    }
  });

  it("does not collide with any other item key in the catalog", () => {
    const others = otherCatalogKeys();
    for (const item of STANDARD_AIRBNB_ITEMS) {
      expect(others.has(item.key), `${item.key} collides with an existing catalog item`).toBe(
        false,
      );
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

  it("keeps mould treatment conditional on the reported `mold` exception", () => {
    const evidence = STANDARD_AIRBNB_ITEMS.find((i) => i.key === "bathroom.mould-treatment");
    expect(evidence?.fieldType).toBe("photo");
    expect(evidence?.required).toBe(false);
    expect(evidence?.frequency).toBe("CONDITIONAL");
    expect(evidence?.conditionKey).toBe("mold");
    // Its old yes/no trigger is gone — the multiselect exception now reveals it.
    expect(STANDARD_AIRBNB_ITEMS.some((i) => i.key === "bathroom.mould-present")).toBe(false);
    expect(EXCEPTION_DEFS.some((d) => d.key === "mold")).toBe(true);
  });

  it("adds NO balcony item — the existing library pair already covers it once", () => {
    // "Furniture set arranged + floor swept/vacuumed" is exactly
    // ev.balcony.balcony-furniture + ev.balcony.balcony-cleaned. A third
    // "Balcony overall" photo would be the duplication this set exists to kill.
    expect(STANDARD_AIRBNB_ITEMS.some((i) => i.moduleKey === "balcony")).toBe(false);
    const evKeys = MANDATORY_EVIDENCE_ITEMS.map((i) => i.key);
    expect(evKeys).toContain("ev.balcony.balcony-furniture");
    expect(evKeys).toContain("ev.balcony.balcony-cleaned");
  });

  it("keeps sort orders inside the reserved 300-399 band, ascending per module", () => {
    const perModule = new Map<string, number[]>();
    for (const item of STANDARD_AIRBNB_ITEMS) {
      expect(item.sortOrder).toBeGreaterThanOrEqual(300);
      expect(item.sortOrder).toBeLessThan(400);
      const list = perModule.get(item.moduleKey) ?? [];
      list.push(item.sortOrder);
      perModule.set(item.moduleKey, list);
    }
    for (const [moduleKey, orders] of perModule) {
      expect(new Set(orders).size, `${moduleKey} has duplicate sortOrders`).toBe(orders.length);
      expect(orders, `${moduleKey} sortOrders should ascend`).toEqual([...orders].sort((a, b) => a - b));
    }
  });
});
