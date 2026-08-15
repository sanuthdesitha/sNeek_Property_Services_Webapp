import { describe, it, expect } from "vitest";
import { DamageSeverity, DamageSuspectedCause, DamagePhotoSection } from "@prisma/client";
import {
  saveDamageDraftSchema,
  submitDamageReportSchema,
  isEmptyDamageItem,
  damageItemDraftSchema,
} from "@/lib/damage/validation";

/**
 * The draft/submit asymmetry is the point of these tests. A draft is a phone
 * autosaving mid-documentation and must accept half-finished work; a submit is
 * a claim about somebody's property and must not.
 *
 * The estimatedCost cases guard a privilege boundary, not a typo: cost is
 * admin-decided on the investigation page, and the routes build their Prisma
 * payload from the PARSED object, so anything stripped here cannot reach the
 * database.
 */

const photo = {
  s3Key: "damage/clx0job1/kitchen-1.jpg",
  section: DamagePhotoSection.OVERVIEW,
};

const completeItem = {
  area: "Kitchen",
  category: "Benchtop",
  severity: DamageSeverity.MAJOR,
  description: "Deep burn mark across the stone near the cooktop.",
  suspectedCause: DamageSuspectedCause.GUEST,
  photos: [photo],
};

describe("saveDamageDraftSchema", () => {
  it("accepts a completely empty draft", () => {
    // Opening the form autosaves before anything is typed.
    const parsed = saveDamageDraftSchema.parse({ items: [] });
    expect(parsed.items).toEqual([]);
  });

  it("accepts an item with photos but no text yet", () => {
    // Photos first, typing later — losing these is the failure mode that matters.
    const parsed = saveDamageDraftSchema.parse({ items: [{ photos: [photo] }] });
    expect(parsed.items[0].photos).toHaveLength(1);
    expect(parsed.items[0].area).toBe("");
    expect(parsed.items[0].severity).toBe(DamageSeverity.MODERATE);
    expect(parsed.items[0].suspectedCause).toBe(DamageSuspectedCause.UNKNOWN);
  });

  it("defaults items when the key is missing entirely", () => {
    expect(saveDamageDraftSchema.parse({}).items).toEqual([]);
  });

  it("trims text fields", () => {
    const parsed = saveDamageDraftSchema.parse({ items: [{ area: "  Kitchen  " }] });
    expect(parsed.items[0].area).toBe("Kitchen");
  });

  it("rejects an unknown severity rather than coercing it", () => {
    expect(() => saveDamageDraftSchema.parse({ items: [{ severity: "CATASTROPHIC" }] })).toThrow();
  });
});

describe("estimatedCost is never accepted from a cleaner", () => {
  it("strips it from a draft item", () => {
    const parsed = damageItemDraftSchema.parse({ ...completeItem, estimatedCost: 950 });
    expect(parsed).not.toHaveProperty("estimatedCost");
  });

  it("strips it from a submitted report", () => {
    const parsed = submitDamageReportSchema.parse({
      items: [{ ...completeItem, estimatedCost: 950 }],
    });
    expect(parsed.items[0]).not.toHaveProperty("estimatedCost");
  });
});

describe("submitDamageReportSchema", () => {
  it("accepts a complete item", () => {
    const parsed = submitDamageReportSchema.parse({ items: [completeItem] });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].severity).toBe(DamageSeverity.MAJOR);
  });

  it("requires at least one item", () => {
    expect(() => submitDamageReportSchema.parse({ items: [] })).toThrow(
      /at least one damaged item/i
    );
  });

  it("requires at least one photo per item", () => {
    expect(() =>
      submitDamageReportSchema.parse({ items: [{ ...completeItem, photos: [] }] })
    ).toThrow(/at least one photo/i);
  });

  it("requires an area", () => {
    expect(() =>
      submitDamageReportSchema.parse({ items: [{ ...completeItem, area: "   " }] })
    ).toThrow(/room or area/i);
  });

  it("requires a category", () => {
    expect(() =>
      submitDamageReportSchema.parse({ items: [{ ...completeItem, category: "" }] })
    ).toThrow(/what was damaged/i);
  });

  it("rejects a one-word description", () => {
    // "Broken" tells an admin nothing and cannot support a claim.
    expect(() =>
      submitDamageReportSchema.parse({ items: [{ ...completeItem, description: "Broken" }] })
    ).toThrow(/at least a sentence/i);
  });

  it("accepts several items in one submission", () => {
    const parsed = submitDamageReportSchema.parse({
      items: [completeItem, { ...completeItem, area: "Bathroom", category: "Mirror" }],
    });
    expect(parsed.items).toHaveLength(2);
  });
});

describe("isEmptyDamageItem", () => {
  it("recognises a freshly added card", () => {
    expect(isEmptyDamageItem(damageItemDraftSchema.parse({}))).toBe(true);
  });

  it("is not fooled by whitespace", () => {
    expect(isEmptyDamageItem(damageItemDraftSchema.parse({ area: "   " }))).toBe(true);
  });

  it("treats a card with only photos as non-empty", () => {
    // Dropping this at submit would discard the evidence.
    expect(isEmptyDamageItem(damageItemDraftSchema.parse({ photos: [photo] }))).toBe(false);
  });

  it("treats any typed text as non-empty", () => {
    expect(isEmptyDamageItem(damageItemDraftSchema.parse({ description: "scratch" }))).toBe(false);
  });
});
