import { describe, it, expect } from "vitest";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { withStandardSections } from "@/lib/checklists/compose";
import {
  STANDARD_SECTION_IDS,
  isStandardSectionId,
  schemaOptsOutOfStandardSections,
} from "@/lib/forms/standard-sections";

const base = {
  sections: [
    {
      id: "kitchen",
      title: "Kitchen",
      fields: [{ id: "k1", type: "checkbox", label: "Benchtops wiped" }],
    },
  ],
};

describe("standardSections opt-out flag", () => {
  it("injects the standard sections when the flag is undefined (un-migrated template)", () => {
    const out = normalizeFormSchema(base);
    const ids = out.sections.map((s: any) => s.id);
    for (const id of STANDARD_SECTION_IDS) expect(ids).toContain(id);
    expect(out.standardSections).toBeUndefined();
  });

  it("injects when the flag is explicitly true", () => {
    const out = normalizeFormSchema({ ...base, standardSections: true });
    const ids = out.sections.map((s: any) => s.id);
    expect(ids).toContain("arrival-evidence");
  });

  it("does NOT inject when the flag is false", () => {
    const out = normalizeFormSchema({ ...base, standardSections: false });
    const ids = out.sections.map((s: any) => s.id);
    expect(ids).toEqual(["kitchen"]);
    for (const id of STANDARD_SECTION_IDS) expect(ids).not.toContain(id);
  });

  it("carries the flag through so a read → save round-trip stays opted out", () => {
    const once = normalizeFormSchema({ ...base, standardSections: false });
    expect(once.standardSections).toBe(false);
    const twice = normalizeFormSchema(once);
    expect(twice.standardSections).toBe(false);
    expect(twice.sections.map((s: any) => s.id)).toEqual(["kitchen"]);
  });

  it("keeps BAKED standard sections when opted out (they are template-owned, not dropped)", () => {
    // What scripts/bake-standard-sections.ts produces: injected once, flag set.
    const baked = {
      sections: withStandardSections(base.sections as any[]),
      standardSections: false,
    };
    const out = normalizeFormSchema(baked);
    const ids = out.sections.map((s: any) => s.id);
    for (const id of STANDARD_SECTION_IDS) expect(ids).toContain(id);
    // …and never duplicated on re-read.
    expect(ids.filter((id: string) => id === "arrival-evidence")).toHaveLength(1);
  });

  it("withStandardSections honours the option directly", () => {
    expect(withStandardSections(base.sections as any[], { standardSections: false })).toEqual(
      base.sections
    );
    expect(
      (withStandardSections(base.sections as any[], {}) as any[]).length
    ).toBeGreaterThan(base.sections.length);
  });

  it("helpers agree on what is standard / opted out", () => {
    expect(isStandardSectionId("sign-off")).toBe(true);
    expect(isStandardSectionId("kitchen")).toBe(false);
    expect(schemaOptsOutOfStandardSections({ standardSections: false })).toBe(true);
    expect(schemaOptsOutOfStandardSections({ standardSections: true })).toBe(false);
    expect(schemaOptsOutOfStandardSections({})).toBe(false);
    expect(schemaOptsOutOfStandardSections(null)).toBe(false);
  });
});
