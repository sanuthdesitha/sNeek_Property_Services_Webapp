import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc } from "@/lib/templates/model";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { BLOCK_REGISTRY } from "@/lib/templates/blocks/registry";

const brand = DEFAULT_BRAND_TOKENS;

describe("report blocks integrate through the registry + engine", () => {
  it("registers the three report-wave blocks", () => {
    expect(BLOCK_REGISTRY.checklistSection).toBeDefined();
    expect(BLOCK_REGISTRY.photoGrid).toBeDefined();
    expect(BLOCK_REGISTRY.qaScoreCard).toBeDefined();
  });

  it("renders a report doc with all three blocks via renderDocumentHtml", () => {
    const doc = {
      ...emptyDoc("doc.clientReport"),
      blocks: [
        { id: "c", type: "checklistSection" as const, props: { bind: "report.sections", showMedia: true } },
        { id: "p", type: "photoGrid" as const, props: { bind: "report.photos", columns: 3 } },
        { id: "q", type: "qaScoreCard" as const, props: { bind: "report.qa" } },
      ],
    };
    const data = {
      report: {
        sections: [
          {
            title: "Kitchen",
            items: [
              { label: "Benches wiped", checked: true, note: "Spotless", media: [{ url: "https://x/1.jpg", type: "PHOTO" }] },
              { label: "Oven", checked: false },
            ],
          },
        ],
        photos: [
          { url: "https://x/a.jpg", type: "PHOTO", caption: "Living room", stamp: "2 Jul 9:14am" },
          { url: "https://x/b.mp4", type: "VIDEO", caption: "Walkthrough" },
        ],
        qa: { score: 93, passed: true, categories: [{ label: "Kitchen", score: 96 }], rework: null },
      },
    };
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    // checklistSection
    expect(html).toContain("tpl-checklist");
    expect(html).toContain("Benches wiped");
    expect(html).toContain("tpl-check-pass");
    // photoGrid
    expect(html).toContain("tpl-photo-grid");
    expect(html).toContain("Living room");
    expect(html).toContain("tpl-photo-video");
    // qaScoreCard
    expect(html).toContain("tpl-qa-card");
    expect(html).toContain("93%");
    expect(html).toContain("width:96%");
    // the CSS for the new classes is present in the <style> block
    expect(html).toContain(".tpl-qa-bar-fill");
    expect(html).toContain(".tpl-photo-grid[data-cols=");
  });
});
