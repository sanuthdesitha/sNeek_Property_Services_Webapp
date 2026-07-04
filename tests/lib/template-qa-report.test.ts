import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc } from "@/lib/templates/model";
import { defaultQaReportDoc, TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { lintTemplateDoc } from "@/lib/templates/lint";
import { extractQaReportData } from "@/lib/reports/qa-report-data";

const brand = DEFAULT_BRAND_TOKENS;
const keyToUrl = (k: string) => `https://cdn.example/${k}`;

describe("doc.qaReport template", () => {
  const doc = { ...emptyDoc("doc.qaReport"), blocks: defaultQaReportDoc() };

  it("passes lint and renders the sample fixture with QA + findings + photos", () => {
    expect(lintTemplateDoc(doc, brand).ok).toBe(true);
    const html = renderDocumentHtml(doc, TEMPLATE_KINDS["doc.qaReport"].sampleData(), brand, "pdf", {});
    expect(html).toContain("12 Marine Parade");
    expect(html).toContain("tpl-qa-card");
    expect(html).toContain("88%");
    expect(html).toContain("tpl-qa-rework"); // rework panel
    expect(html).toContain("Damage findings");
    expect(html).toContain("tpl-photo-grid");
  });
});

describe("extractQaReportData (db-free, injected key→url)", () => {
  function fakeInputs() {
    const submission = {
      score: 88,
      passed: true,
      notes: "Minor touch-up needed.",
      categoryScores: { kitchen: 92, bath: 84 },
      template: {
        schema: {
          sections: [
            { id: "kitchen", label: "Kitchen", fields: [{ id: "benches", type: "checkbox", label: "Benchtops" }, { id: "rate", type: "rating", max: 5, label: "Rating" }] },
            { id: "bath", label: "Bathroom", fields: [{ id: "shower", type: "checkbox", label: "Shower glass" }] },
          ],
        },
      },
      data: { benches: true, rate: 4, shower: false },
    };
    const tools = {
      sectionPhotos: { kitchen: ["k1.jpg", "k2.jpg"], bath: ["b1.jpg"] },
      damage: [{ area: "Vanity", severity: "MEDIUM", description: "Chip on edge", photoKeys: ["dmg1.jpg"] }],
      rework: { enabled: true, severity: "MINOR", reason: "Redo shower glass", areas: ["Shower glass"], minutesFromCleaner: 15, amountFromCleaner: 12 },
    };
    return {
      job: { id: "job_1", jobType: "AIRBNB_TURNOVER", jobNumber: "J-100", property: { name: "12 Marine Parade", suburb: "Coogee" } },
      submission,
      qa: { score: 88, passed: true, notes: "Minor touch-up needed." },
      tools,
      localDate: "2 July 2026",
      inspector: "Marco P.",
      cleaners: "Ana R.",
      onSiteMinutes: 18,
    };
  }

  it("normalizes verdict/categories/rework/sections/findings/photos", () => {
    const data = extractQaReportData(fakeInputs(), keyToUrl);
    expect(data.report.property.jobType).toBe("AIRBNB TURNOVER");
    expect(data.report.meta.inspector).toBe("Marco P.");
    expect(data.report.meta.onSiteMinutes).toBe("18 min");
    expect(data.report.qa?.score).toBe(88);
    expect(data.report.qa?.passed).toBe(true);
    expect(data.report.qa?.categories.map((c) => c.label)).toEqual(["Kitchen", "Bathroom"]);
    expect(data.report.qa?.rework?.required).toBe(true);
    expect(data.report.qa?.rework?.areas).toEqual(["Shower glass"]);
    // sections: checkbox → checked, rating → value
    const kitchen = data.report.sections.find((s) => s.title === "Kitchen");
    expect(kitchen?.items.find((i) => i.label === "Benchtops")?.checked).toBe(true);
    expect(kitchen?.items.find((i) => i.label === "Rating")?.value).toBe("4 / 5");
    // findings: damage → one section, media key→url injected
    expect(data.report.hasFindings).toBe(true);
    expect(data.report.findings[0].items[0].label).toBe("Vanity");
    expect(data.report.findings[0].items[0].value).toBe("MEDIUM");
    expect(data.report.findings[0].items[0].media?.[0]?.url).toBe("https://cdn.example/dmg1.jpg");
    // photos: all section photos flattened + url-mapped
    expect(data.report.photos.length).toBe(3);
    expect(data.report.photos[0].url).toBe("https://cdn.example/k1.jpg");
  });

  it("renders the doc.qaReport from extracted data", () => {
    const data = extractQaReportData(fakeInputs(), keyToUrl);
    const doc = { ...emptyDoc("doc.qaReport"), blocks: defaultQaReportDoc() };
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).toContain("Vanity");
    expect(html).toContain("tpl-qa-rework");
    expect(html).toContain("https://cdn.example/dmg1.jpg");
    expect(html).toContain(">Passed<");
  });

  it("returns hasQa=false / no rework when QA is absent", () => {
    const inputs = fakeInputs();
    inputs.submission.score = null as never;
    inputs.submission.passed = null as never;
    inputs.submission.categoryScores = {} as never;
    inputs.qa = { score: null, passed: null, notes: "" } as never;
    inputs.tools.rework = { enabled: false } as never;
    const data = extractQaReportData(inputs, keyToUrl);
    expect(data.report.hasQa).toBe(false);
    expect(data.report.qa).toBeNull();
  });
});
