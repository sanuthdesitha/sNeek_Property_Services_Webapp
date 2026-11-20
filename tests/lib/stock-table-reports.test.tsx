/**
 * Stock used tables in the office views and the client report: rendered
 * from the submission's server record (`__stockTable`); the client report
 * shows them only where it already shows stock usage (the theme's Supplies
 * section); older submissions without a record render exactly as before.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildReportViewModel } from "@/lib/reports/report-view-model";
import { renderEstateReport, type EstateRenderCtx } from "@/lib/reports/estate-template";
import { TableAnswer, inlineAnswerText, isBlockAnswer } from "@/components/v2/admin/forms/submissions/structured-answer";
import { AnswerEditor } from "@/components/v2/admin/forms/submissions/submission-answer-editor";

afterEach(cleanup);

const field = { id: "bath", type: "inventory", label: "Bathroom supplies used", stockArea: "bathroom" };
const schema = { sections: [{ id: "s", title: "Bathroom", fields: [field] }] };
const record = { fields: [{ fieldId: "bath", label: "Bathroom supplies used", show: "bathroom", rows: [
  { itemId: "tp", name: "Toilet paper", unit: "roll", used: 2 },
  { itemId: "soap", name: "Hand soap", unit: "bottle", used: 0 },
] }], usage: { tp: 2 }, coveredItemIds: ["soap", "tp"], ignoredItemIds: [] };
const job = { id: "j", property: { name: "P1" }, assignments: [] };
const ctx: EstateRenderCtx = {
  headTags: "", primaryHsl: "0 0% 0%", accentHsl: "0 0% 0%", companyName: "Test", logoUrl: "", renderedTitle: "Test", photoDims: { w: 100, h: 100 },
  showHeader: true, showSummary: true, showTaskChecklist: true, showGallery: true, showQaSummary: true, showSupplies: true, showFooter: true, customFooter: "",
};

describe("client report", () => {
  const submission = { id: "s1", data: { __templateSchema: schema, stockTableUsage: { tp: 2, soap: 0 }, __stockTable: record }, media: [], stockTxs: [] };

  it("renders the recorded table where Supplies are shown", () => {
    const vm = buildReportViewModel({ job, submission, localDate: "20 November 2026" });
    const row = vm.sections.flatMap((section) => section.fields).find((entry) => entry.id === "bath")!;
    expect(row).toMatchObject({ kind: "table", stockTable: true, answered: true, table: { columns: ["Item", "Used"], rows: [["Toilet paper", "2 roll"], ["Hand soap", "None used"]] } });
    expect(renderEstateReport(vm, ctx)).toContain("Toilet paper");
  });

  it("does not start showing stock usage where the theme hides Supplies", () => {
    const vm = buildReportViewModel({ job, submission, localDate: "20 November 2026" });
    const html = renderEstateReport(vm, { ...ctx, showSupplies: false });
    expect(html).not.toContain("Toilet paper");
    expect(html).not.toContain("Bathroom supplies used");
  });

  it("renders an older submission without a record exactly as before", () => {
    const old = { id: "s0", data: { __templateSchema: schema, inventoryUsage: { tp: 2 } }, media: [], stockTxs: [] };
    const vm = buildReportViewModel({ job, submission: old, localDate: "1 August 2026" });
    const row = vm.sections.flatMap((section) => section.fields).find((entry) => entry.id === "bath")!;
    expect(row).toMatchObject({ kind: "value", answered: false });
    expect(row.stockTable).toBeUndefined();
    expect(renderEstateReport(vm, { ...ctx, showSupplies: false })).toContain("Bathroom supplies used");
  });
});

describe("office submission views", () => {
  const data = { stockTableUsage: { tp: 2, soap: 0 }, __stockTable: record };

  it("shows the recorded table as Item / Used", () => {
    expect(isBlockAnswer(field, data)).toBe(true);
    render(<TableAnswer field={field} value={undefined} data={data} />);
    expect(screen.getByRole("columnheader", { name: "Used" })).toBeTruthy();
    expect(screen.getByText("None used")).toBeTruthy();
  });

  it("falls back to the previous text for an older submission", () => {
    expect(isBlockAnswer(field, { inventoryUsage: { tp: 1 } })).toBe(false);
    expect(inlineAnswerText(field, "typed on the old text box")).toBe("typed on the old text box");
  });

  it("keeps the answer locked in the office editor and says why", () => {
    render(<AnswerEditor field={{ ...field, sectionTitle: "Bathroom" } as never} value={undefined} data={data} onChange={() => {}} />);
    expect(screen.getByText(/stock used was taken off the property's stock when the form was submitted/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
