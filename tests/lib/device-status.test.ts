import { describe, expect, it } from "vitest";
import { isDeviceStatusField, isDeviceAnswerComplete, withDeviceApplicability } from "@/lib/forms/device-status";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { collectRequiredAnswerFields } from "@/lib/forms/visibility";
import { formatFieldValue } from "@/lib/forms/field-types";
import { renderEstateReport } from "@/lib/reports/estate-template";
import { buildReportViewModel } from "@/lib/reports/report-view-model";
import { computeQaScore } from "@/lib/qa/scoring";
const field = { id: "minut", label: "Minut charged?", type: "checkbox", required: true };
const schema = { sections: [{ id: "devices", title: "Devices", fields: [field] }] };
describe("truthful device outcomes", () => {
 it.each(["NEEDS_ATTENTION", "NOT_APPLICABLE", "NOT_CHECKED"])("accepts explicit %s with reason on client and server, without counting it as a completed check", deviceStatus => {
  const value = { deviceStatus, reason: "Owner did not check this today." };
  expect(collectFormErrors(schema, { minut: value }, {}, {}, false, true)).toEqual([]);
  expect(collectRequiredAnswerFields(schema, { minut: value }, {}, { requiredChecklistTicksBlockSubmit: true })).toEqual([]);
  expect(computeQaScore({ sections: [{ ...schema.sections[0], fields: [{ ...field, type: "checkbox", scoring: { max: 1, weight: 1 } }] }] }, { minut: value }).totalPoints).toBe(0);
  expect(formatFieldValue(field as any, value)).toContain(value.reason);
 });
 it.each([undefined, false, "na", {}, { deviceStatus: "NOT_CHECKED", reason: " " }, { deviceStatus: "WORKING", reason: "x" }, { deviceStatus: "NOT_APPLICABLE", reason: "x".repeat(2001) }])("blocks missing or malformed exception %#", value => {
  expect(isDeviceAnswerComplete(value)).toBe(false);
  expect(collectRequiredAnswerFields(schema, { minut: value }, {}, { requiredChecklistTicksBlockSubmit: true })).toHaveLength(1);
 });
 it("requires an exception reason even when the device field is optional", () => {
  const optional = { sections: [{ id: "s", fields: [{ ...field, required: false }] }] };
  expect(collectFormErrors(optional, { minut: { deviceStatus: "NOT_CHECKED", reason: "" } }, {}, {})).toHaveLength(1);
 });
 it("preserves positive historical booleans and unrelated required checkboxes", () => {
  expect(collectRequiredAnswerFields(schema, { minut: true }, {}, { requiredChecklistTicksBlockSubmit: true })).toEqual([]);
  expect(formatFieldValue(field as any, false)).toBe("No");
  const other = { ...field, id: "floor", label: "Floor cleaned" };
  expect(collectFormErrors({ sections: [{ id: "s", fields: [other] }] }, { floor: false }, {}, {}, false, true)).toHaveLength(1);
  expect(isDeviceStatusField({ ...other, label: "Ring marks removed" })).toBe(false);
  expect(isDeviceStatusField({ ...field, type: "photo" })).toBe(false);
 });
 it("removes only P3 Ring checks in active schema copies, retaining Minut, combined fields and historical schema/answers", () => {
  const input = { sections: [{ id: "s", fields: [field, { ...field, id: "ring", label: "Ring camera charged" }, { ...field, id: "both", label: "Ring camera and Minut checked" }, { id: "sig", type: "signature", label: "Signature" }] }] };
  const original = JSON.stringify(input);
  const result = withDeviceApplicability(input, { name: "JacksonP3" });
  expect(result.sections[0].fields.map((f: any) => f.id)).toEqual(["minut", "both", "sig", "s-ring-removed-p3-v1"]);
  expect(result.deviceApplicability.ring).toMatchObject({ status: "REMOVED", source: "OWNER_INSTRUCTION" });
  expect(JSON.stringify(input)).toBe(original);
  for (const name of ["P3", "JacksonP30", "Jackson Property-11", "P4", "Unit P3 elsewhere"]) expect(withDeviceApplicability(input, { name })).toBe(input);
 });
 it("exports the precise exception and reason from a legacy checkbox snapshot", () => {
  const value = { deviceStatus: "NOT_CHECKED", reason: "Not checked today — owner instruction." };
  const vm = buildReportViewModel({ job: { id: "j", property: { name: "P3" }, assignments: [] }, submission: { id: "s", data: { __templateSchema: schema, minut: value }, media: [], stockTxs: [] }, localDate: "4 October 2026" });
  const exported = vm.sections.flatMap(section => section.fields).find(row => row.id === "minut")!;
  expect(exported).toMatchObject({ kind: "value", answered: true, value: "Not checked / unknown — Not checked today — owner instruction." });
  expect(exported.checked).toBeUndefined();
  expect(vm.stats.find(stat => stat.label === "Checklist answered")).toBeDefined();
  expect(vm.flags.some(flag => flag.label === "Device exceptions — review required")).toBe(true);
  const html = renderEstateReport(vm, { headTags: "", primaryHsl: "0 0% 0%", accentHsl: "0 0% 0%", companyName: "Test", logoUrl: "", renderedTitle: "Test", photoDims: { w: 100, h: 100 }, showHeader: true, showSummary: true, showTaskChecklist: true, showGallery: true, showQaSummary: true, showSupplies: true, showFooter: true, customFooter: "" });
  expect(html).toContain("Not checked / unknown");
  expect(html).toContain("Not checked today — owner instruction.");
  expect(html).toContain("1/1 answered");
  expect(html).not.toContain("1/1 completed");
 });
});
