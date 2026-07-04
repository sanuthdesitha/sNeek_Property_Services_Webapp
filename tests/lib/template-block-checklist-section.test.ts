import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { checklistSectionBlock } from "@/lib/templates/blocks/defs/checklist-section";

const sampleSections = [
  {
    title: "Kitchen",
    items: [
      {
        label: "Benchtops wiped",
        checked: true,
        note: "Left a small streak near sink",
        media: [{ url: "https://cdn.example.com/bench.jpg", type: "PHOTO", caption: "Bench" }],
      },
      { label: "Oven cleaned", checked: false },
      { label: "Fridge temperature", value: "3°C" },
    ],
  },
  {
    title: "Bathroom",
    items: [{ label: "Mirror polished", checked: true }],
  },
];

function makeCtx(sections: unknown) {
  return {
    channel: "pdf",
    brand: DEFAULT_BRAND_TOKENS,
    theme: {},
    data: { report: { sections } },
    merge: (s: string) => s,
    mergeText: (s: string) => s,
    color: (_r: string | undefined, f: string) => f,
    style: {},
  } as any;
}

describe("checklistSection block", () => {
  it("renders full-mode sections with glyphs, note, media, and value", () => {
    const ctx = makeCtx(sampleSections);
    const props = checklistSectionBlock.propsSchema.parse({
      bind: "report.sections",
      showMedia: true,
    });
    const html = checklistSectionBlock.renderDocument!(props, ctx);

    // pass / fail glyphs
    expect(html).toContain("tpl-check-pass");
    expect(html).toContain("✓");
    expect(html).toContain("tpl-check-fail");
    expect(html).toContain("✗");

    // note text present in full mode
    expect(html).toContain("Left a small streak near sink");

    // photo media thumb rendered
    expect(html).toContain("<img");
    expect(html).toContain("tpl-item-thumb");

    // both section titles
    expect(html).toContain("Kitchen");
    expect(html).toContain("Bathroom");

    // item value present
    expect(html).toContain("3°C");
    expect(html).toContain("tpl-item-value");
  });

  it("marketing mode suppresses notes + media and mutes excluded items", () => {
    const ctx = makeCtx(sampleSections);
    const props = checklistSectionBlock.propsSchema.parse({
      bind: "report.sections",
      mode: "marketing",
    });
    const html = checklistSectionBlock.renderDocument!(props, ctx);

    // notes and media suppressed
    expect(html).not.toContain("Left a small streak near sink");
    expect(html).not.toContain("<img");

    // unchecked item is muted + flagged excluded
    expect(html).toContain("tpl-item-excluded");

    // checked items still render normally
    expect(html).toContain("✓");
  });

  it("renders emptyText when the bound path is missing", () => {
    const ctx = makeCtx(sampleSections);
    const props = checklistSectionBlock.propsSchema.parse({
      bind: "report.nope",
      emptyText: "Nothing to show.",
    });
    const html = checklistSectionBlock.renderDocument!(props, ctx);

    expect(html).toContain("Nothing to show.");
    expect(html).toContain("tpl-empty");
  });
});
