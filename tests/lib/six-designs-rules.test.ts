// @vitest-environment node
/**
 * Pure rules behind Property form settings, Checklist coverage and Report
 * themes (boards 2026-11-17).
 */
import { describe, expect, it } from "vitest";
import { describeChanges, previewGroups, systemFieldChanged } from "@/components/v2/admin/settings/property-form-model";
import { missingRequiredForProperty, type StoredPropertyFacts } from "@/lib/property-form/missing-required";
import { matchesRowChip } from "@/lib/properties/portfolio-rules";
import { layoutWords, oldestDraftDays, tileCounts, type CoverageRow } from "@/components/v2/admin/checklists/coverage-model";
import { footerPlainText, footerTextToHtml, normalizeThemeLayout, unknownTitleVariables, whiteTextContrast } from "@/lib/reports/theme-rules";
import type { PropertyFormConfig } from "@/lib/property-form/config";

const empty: PropertyFormConfig = { version: 1, systemFields: {}, customFields: [] };

describe("property form editor", () => {
  it("lists each unsaved change in words for the bar", () => {
    const draft: PropertyFormConfig = {
      version: 1,
      systemFields: { postcode: { required: true, hidden: false }, sofaBedCount: { hidden: true } },
      customFields: [{ id: "cf1", label: "Bin day", type: "select", required: true, options: ["Mon"] }],
    };
    expect(describeChanges(empty, draft).map((change) => change.text)).toEqual([
      "Postcode: Optional → Required",
      "Sofa beds: Optional → Hidden",
      "Bin day: new custom field",
    ]);
    expect(systemFieldChanged("postcode", empty, draft)).toBe(true);
    expect(systemFieldChanged("clientId", empty, draft)).toBe(false);
  });

  it("previews the new property form: hidden fields left out, required in words, custom fields under Your fields", () => {
    const draft: PropertyFormConfig = { version: 1, systemFields: { sofaBedCount: { hidden: true } }, customFields: [{ id: "wifi", label: "Wi-Fi network", type: "text" }] };
    const groups = previewGroups(draft, new Map());
    const all = groups.flatMap((group) => group.fields);
    expect(all.find((field) => field.id === "sofaBedCount")).toBeUndefined();
    expect(all.find((field) => field.id === "clientId")?.required).toBe(true);
    expect(groups[groups.length - 1]).toMatchObject({ label: "Your fields", fields: [{ id: "wifi", required: false }] });
  });
});

describe("Missing required details (Properties filter; nothing blocked)", () => {
  const property: StoredPropertyFacts = {
    clientId: "c", name: "Glebe House", address: "1 Rd", suburb: "Glebe", state: "NSW", postcode: null, linenBufferSets: 0, bedrooms: 2, bathrooms: 1,
    defaultCheckinTime: "14:00", defaultCheckoutTime: "10:00", hasBalcony: false, inventoryEnabled: false, laundryEnabled: true, cleaningDurationMinutes: null,
    assignedCleaningHours: null, cleanerServiceRate: null, sofaBedCount: 0, laundryBagLabel: null, laundryBagColor: null, setupGuide: null, notes: null,
    accessInfo: { lockbox: "" }, hasAccessCode: true, customFields: { bin: "" },
  };

  it("lists a newly required field the property lacks, counting an encrypted access code as present", () => {
    const config: PropertyFormConfig = { version: 1, systemFields: { postcode: { required: true }, codes: { required: true } }, customFields: [{ id: "bin", label: "Bin day", type: "text", required: true }] };
    expect(missingRequiredForProperty(config, property).map((field) => field.label)).toEqual(["Postcode", "Bin day"]);
    expect(missingRequiredForProperty(empty, property)).toEqual([]);
  });

  it("is a chip of its own, not a flag (it does not make a property need attention)", () => {
    expect(matchesRowChip({ flags: [], missingRequired: ["Postcode"] }, "missing-details")).toBe(true);
    expect(matchesRowChip({ flags: [], missingRequired: ["Postcode"] }, "attention")).toBe(false);
    expect(matchesRowChip({ flags: [], missingRequired: undefined }, "missing-details")).toBe(false);
  });
});

describe("checklist coverage", () => {
  const row = (over: Partial<CoverageRow>): CoverageRow => ({ id: "p", name: "P", suburb: "S", clientName: "C", bedrooms: 2, bathrooms: 1, hasBalcony: false, hasFeatures: true, checklistStatus: "APPROVED", approvedAt: null, ...over });

  it("counts every tile from the rows and reads 0 bedrooms as not set", () => {
    const rows = [row({}), row({ checklistStatus: "DRAFT", profileCreatedAt: "2026-11-06T00:00:00Z" }), row({ checklistStatus: "STALE", hasFeatures: false }), row({ checklistStatus: "NONE", hasFeatures: false })];
    expect(tileCounts(rows)).toEqual({ all: 4, APPROVED: 1, DRAFT: 1, STALE: 1, NONE: 1, "no-amenities": 2 });
    expect(oldestDraftDays(rows, new Date("2026-11-15T00:00:00Z"))).toBe(9);
    expect(layoutWords({ bedrooms: 0, bathrooms: 1, hasBalcony: true })).toBe("Bedrooms not set · 1 bath · balcony");
  });
});

describe("report themes", () => {
  it("allows only the three title variables the generator fills", () => {
    expect(unknownTitleVariables("Report: {{property.name}}, {{job.scheduledFor|date short}} {{job.jobNumber}}")).toEqual([]);
    expect(unknownTitleVariables("{{client.name}} {{job.scheduledFor | date long}}")).toEqual(["{{client.name}}", "{{job.scheduledFor | date long}}"]);
  });

  it("renders the footer as escaped text with links, so a tag cannot break the PDF", () => {
    expect(footerPlainText("<p>sNeek <b>Pty</b></p>")).toBe("sNeek Pty");
    expect(footerTextToHtml("sNeek · hello@sneek.au · https://sneek.au <script>")).toBe(
      'sNeek · <a href="mailto:hello@sneek.au">hello@sneek.au</a> · <a href="https://sneek.au">https://sneek.au</a>',
    );
  });

  it("checks white text on the main colour and completes the section list", () => {
    expect(whiteTextContrast("158 42% 20%")).toBeGreaterThan(10);
    expect(whiteTextContrast("41 42% 57%")!).toBeLessThan(4.5);
    expect(whiteTextContrast("not a colour")).toBeNull();
    const layout = normalizeThemeLayout({ sections: [{ id: "footer", visible: true, order: 0 }, { id: "supplies", visible: false, order: 1 }], photoSize: "huge" });
    expect(layout.photoSize).toBe("medium");
    expect(layout.sections.map((section) => section.id).slice(0, 2)).toEqual(["footer", "supplies"]);
    expect(layout.sections).toHaveLength(8);
    expect(layout.sections.find((section) => section.id === "supplies")?.visible).toBe(false);
  });
});
