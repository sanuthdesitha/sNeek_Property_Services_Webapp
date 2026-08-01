import { describe, expect, it } from "vitest";
import {
  generateQaTemplateFromChecklist,
  qaTemplateMatchesChecklist,
} from "@/lib/qa/generate-from-checklist";

/**
 * Modelled on the shape of a real turnover checklist (the live P11 airbnb form:
 * thirteen sections, ~100 fields, two separate bathrooms, three bedrooms).
 *
 * The invariant that matters most is the section TITLE. `lib/qa/section-match.ts`
 * pairs QA sections with cleaner sections by normalised title containment, and
 * that pairing is what shows the cleaner's photos beside the grading. If a
 * generated title drifts, nothing errors — the photo strip just silently
 * disappears and the inspector grades blind.
 */

const CHECKLIST = {
  sections: [
    {
      id: "kitchen",
      title: "Kitchen",
      fields: [
        { id: "k1", type: "checkbox", label: "Wipe benchtops and splashback" },
        { id: "k2", type: "photo", label: "Check inside oven, racks and door glass" },
        { id: "k3", type: "checkbox", label: "Clean stovetop and rangehood face" },
        { id: "k4", type: "photo", label: "Coffee machine wiped and filter cleaned" },
        { id: "k5", type: "checkbox", label: "Sweep and mop kitchen floor" },
        { id: "k6", type: "checkbox", label: "Empty bins and replace liners" },
        { id: "k7", type: "checkbox", label: "Restock consumables (dishwashing, paper towel)" },
        { id: "k8", type: "checkbox", label: "Reset all the drawers and cupboards to default layout" },
        { id: "k9", type: "instruction", label: "Read this before you start" },
      ],
    },
    {
      id: "bathrooms-1",
      title: "Bathroom 1 Downstairs",
      fields: [
        { id: "b1", type: "photo", label: "Clean and sanitise toilet" },
        { id: "b2", type: "photo", label: "Clean shower, screen and tiles" },
        { id: "b3", type: "checkbox", label: "Clean basin, vanity and mirror" },
        { id: "b4", type: "checkbox", label: "Replace towels and bath mat" },
      ],
    },
    {
      id: "bedrooms-1",
      title: "Bedroom 1 Queen",
      fields: [
        { id: "d1", type: "photo", label: "Strip and remake beds with fresh linen" },
        { id: "d2", type: "checkbox", label: "Vaccum under the beds" },
        { id: "d3", type: "checkbox", label: "Reset the bedroom as per reference Images" },
      ],
    },
    // No gradeable work — must not produce an empty QA section.
    { id: "notes-only", title: "Notes", fields: [{ id: "n1", type: "instruction", label: "FYI" }] },
    { id: "untitled", title: "", fields: [{ id: "u1", type: "checkbox", label: "x" }] },
  ],
} as any;

describe("generateQaTemplateFromChecklist", () => {
  it("mirrors section titles VERBATIM so section-match keeps working", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const titles = (out.schema.sections as any[]).map((s) => s.title);
    expect(titles).toContain("Kitchen");
    expect(titles).toContain("Bathroom 1 Downstairs");
    expect(titles).toContain("Bedroom 1 Queen");
    expect(out.mirroredSectionTitles).toEqual([
      "Kitchen",
      "Bathroom 1 Downstairs",
      "Bedroom 1 Queen",
    ]);
  });

  it("COLLAPSES rather than mirroring — a 100-field checklist must not yield 100 verdicts", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const kitchen = (out.schema.sections as any[]).find((s) => s.title === "Kitchen");
    const graded = kitchen.fields.filter((f: any) => f.type === "radio");
    // Eight work fields in, a handful of outcomes out.
    expect(graded.length).toBeGreaterThan(1);
    expect(graded.length).toBeLessThanOrEqual(6);
  });

  it("respects an explicit outcome cap", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST, { maxOutcomesPerSection: 2 })!;
    const kitchen = (out.schema.sections as any[]).find((s) => s.title === "Kitchen");
    expect(kitchen.fields.filter((f: any) => f.type === "radio")).toHaveLength(2);
  });

  it("uses Pass / Minor issues / Fail so the verdict is the single input", () => {
    // A star rating PLUS a verdict is the duplicate-input defect on the old
    // default template; Pass/Minor/Fail lets the workspace derive the answer.
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const graded = (out.schema.sections as any[])[0].fields.filter((f: any) => f.type === "radio");
    for (const f of graded) {
      expect(f.options).toEqual(["Pass", "Minor issues", "Fail"]);
      expect(f.scoring).toEqual({ max: 2, weight: 1 });
    }
  });

  it("tells the inspector which checklist lines each verdict stands in for", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const kitchen = (out.schema.sections as any[]).find((s) => s.title === "Kitchen");
    expect(kitchen.fields.filter((f: any) => f.helpText).length).toBeGreaterThan(0);
    expect(JSON.stringify(kitchen.fields)).toContain("Covers:");
  });

  it("skips sections with no gradeable work and sections with no title", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const titles = (out.schema.sections as any[]).map((s) => s.title);
    expect(titles).not.toContain("Notes");
    expect(titles).not.toContain("");
  });

  it("appends the cross-cutting Common mistakes section", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const common = (out.schema.sections as any[]).find((s) => s.title === "Common mistakes");
    expect(common).toBeTruthy();
    expect(JSON.stringify(common.fields)).toContain("Vacuum cleaner emptied");
    expect(JSON.stringify(common.fields)).toContain("guest belongings");
  });

  it("ends with an Outcome section whose fields belong to the inspector", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const sections = out.schema.sections as any[];
    const last = sections[sections.length - 1];
    expect(last.title).toBe("Outcome");
    const ids = last.fields.map((f: any) => f.id);
    // These ids are on the workspace's non-gradeable list — they must never
    // carry a "How was it done?" verdict.
    expect(ids).toContain("qa_notes");
    expect(ids).toContain("rework_required");
    expect(ids).toContain("signature");
  });

  it("gives every mirrored section an evidence upload", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    for (const title of ["Kitchen", "Bathroom 1 Downstairs", "Bedroom 1 Queen"]) {
      const s = (out.schema.sections as any[]).find((x) => x.title === title);
      expect(s.fields.some((f: any) => f.type === "photo")).toBe(true);
    }
  });

  it("returns null when there is nothing to generate from", () => {
    expect(generateQaTemplateFromChecklist(null)).toBeNull();
    expect(generateQaTemplateFromChecklist({ sections: [] } as any)).toBeNull();
    expect(
      generateQaTemplateFromChecklist({ sections: [{ id: "a", title: "A", fields: [] }] } as any)
    ).toBeNull();
  });
});

describe("qaTemplateMatchesChecklist", () => {
  it("passes when every checklist section is mirrored", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    // "Notes"/untitled were legitimately skipped, so compare against the
    // sections that actually carry work.
    const workOnly = {
      sections: (CHECKLIST.sections as any[]).filter((s) =>
        out.mirroredSectionTitles.includes(s.title)
      ),
    } as any;
    expect(qaTemplateMatchesChecklist(out.schema, workOnly).matches).toBe(true);
  });

  it("reports drift when the checklist gains a section the QA form lacks", () => {
    const out = generateQaTemplateFromChecklist(CHECKLIST)!;
    const grown = {
      sections: [...(CHECKLIST.sections as any[]), { id: "balcony", title: "Balcony", fields: [] }],
    } as any;
    const result = qaTemplateMatchesChecklist(out.schema, grown);
    expect(result.matches).toBe(false);
    expect(result.missingTitles).toContain("Balcony");
  });

  it("ignores case and punctuation differences", () => {
    const qa = { sections: [{ id: "a", title: "Bathroom 1 — Downstairs" }] } as any;
    const src = { sections: [{ id: "a", title: "bathroom 1 downstairs" }] } as any;
    expect(qaTemplateMatchesChecklist(qa, src).matches).toBe(true);
  });
});
