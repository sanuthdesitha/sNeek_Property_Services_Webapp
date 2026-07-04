import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc } from "@/lib/templates/model";
import { defaultClientReportDoc, TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { lintTemplateDoc } from "@/lib/templates/lint";
// The extractor lives in a db-free module (split out of generator.ts) so it is
// unit-testable here — the legacy report reuses the very same helpers.
import { extractClientReportData } from "@/lib/reports/client-report-data";

const brand = DEFAULT_BRAND_TOKENS;

describe("doc.clientReport template", () => {
  const doc = { ...emptyDoc("doc.clientReport"), blocks: defaultClientReportDoc() };

  it("passes lint and renders the sample fixture with all report blocks", () => {
    expect(lintTemplateDoc(doc, brand).ok).toBe(true);
    const html = renderDocumentHtml(doc, TEMPLATE_KINDS["doc.clientReport"].sampleData(), brand, "pdf", {});
    expect(html).toContain("12 Marine Parade");
    expect(html).toContain("Airbnb Turnover");
    expect(html).toContain("tpl-checklist");
    expect(html).toContain("Oven cleaned");
    expect(html).toContain("Benches &amp; splashback wiped"); // & is HTML-escaped
    expect(html).toContain("tpl-photo-grid");
    expect(html).toContain(">Passed<"); // qaScoreCard verdict rendered
    expect(html).toContain("96%");
  });

  it("hides the QA card body when report.hasQa is false", () => {
    const noQa = JSON.parse(JSON.stringify(TEMPLATE_KINDS["doc.clientReport"].sampleData()));
    noQa.report.hasQa = false;
    noQa.report.qa = null;
    const html = renderDocumentHtml(doc, noQa, brand, "pdf", {});
    // The .tpl-qa-* CSS is always in <style>; assert the RENDERED verdict is gone.
    expect(html).not.toContain(">Passed<");
    expect(html).toContain("tpl-checklist"); // the rest still renders
  });
});

describe("extractClientReportData (reuses legacy visibility/value helpers)", () => {
  function fakeInputs() {
    const job = {
      id: "job_1",
      jobType: "AIRBNB_TURNOVER",
      property: { name: "12 Marine Parade", suburb: "Coogee", hasBalcony: true, client: { name: "James H." } },
    };
    const submission = {
      submittedBy: { name: "Ana R." },
      template: { schema: null },
      media: [
        { id: "m1", fieldId: "f_oven", mediaType: "PHOTO", url: "https://x/oven.jpg", label: "Oven" },
        { id: "m2", fieldId: "f_notes", mediaType: "VIDEO", url: "https://x/walk.mp4", label: "Walkthrough" },
      ],
      data: {
        __templateSchema: {
          sections: [
            {
              id: "kitchen",
              label: "Kitchen",
              fields: [
                { id: "f_oven", type: "checkbox", label: "Oven cleaned" },
                { id: "f_bin", type: "checkbox", label: "Bin emptied" },
                { id: "f_towels", type: "text", label: "Towels restocked" },
              ],
            },
          ],
        },
        f_oven: true,
        f_bin: false,
        f_towels: "4 towels",
      },
    };
    return { job, submission, qa: { score: 92, passed: true }, qaSubmission: null, localDate: "2 July 2026" };
  }

  it("normalizes checklist items (checked/value/media) + property + QA", () => {
    const data = extractClientReportData(fakeInputs());
    expect(data.report.property.name).toBe("12 Marine Parade");
    expect(data.report.property.jobType).toBe("AIRBNB TURNOVER");
    expect(data.report.property.cleaner).toBe("Ana R.");
    expect(data.report.property.client).toBe("James H.");
    const kitchen = data.report.sections.find((s) => s.title === "Kitchen");
    expect(kitchen).toBeTruthy();
    expect(kitchen!.items.find((i) => i.label === "Oven cleaned")?.checked).toBe(true);
    expect(kitchen!.items.find((i) => i.label === "Oven cleaned")?.media?.[0]?.url).toBe("https://x/oven.jpg");
    expect(kitchen!.items.find((i) => i.label === "Bin emptied")?.checked).toBe(false);
    expect(kitchen!.items.find((i) => i.label === "Towels restocked")?.value).toBe("4 towels");
    expect(data.report.photos.length).toBe(2);
    expect(data.report.hasQa).toBe(true);
    expect(data.report.qa?.score).toBe(92);
  });

  it("renders the doc.clientReport from extracted live-shaped data", () => {
    const data = extractClientReportData(fakeInputs());
    const doc = { ...emptyDoc("doc.clientReport"), blocks: defaultClientReportDoc() };
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).toContain("Oven cleaned");
    expect(html).toContain("4 towels");
    expect(html).toContain("tpl-check-pass"); // oven checked
    expect(html).toContain("tpl-check-fail"); // bin unchecked
  });
});
