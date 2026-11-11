import { describe, expect, it } from "vitest";
import { extendedValidationOutcome, readSubmissionWarnings } from "@/lib/forms/submission-warnings";
import { collectFormErrors, ENFORCE_EXTENDED_FORM_VALIDATION } from "@/lib/forms/validate-submission";

const schema = {
  sections: [{ id: "s", title: "Kitchen", fields: [
    { id: "n", type: "number", label: "Count", min: 0, max: 5 },
    { id: "yn", type: "yesno", label: "All good", detailsWhenNo: true },
    { id: "p", type: "photo", label: "Photos", maxFiles: 1 },
    { id: "req", type: "text", label: "Name", required: true },
  ] }],
};
const input = { schema, answers: { n: 9, yn: false }, uploads: { p: ["a", "b", "a"] }, property: {}, requiredChecklistTicksBlockSubmit: false, noPhoto: { canUseNoPhoto: false, reasons: {} } };

describe("extended submit validation roll-out", () => {
  it("ships switched off", () => {
    expect(ENFORCE_EXTENDED_FORM_VALIDATION).toBe(false);
  });
  it("warn mode: records only the extended rules, never the core ones the route already rejects", () => {
    const outcome = extendedValidationOutcome(input, false);
    expect(outcome.reject).toBe(false);
    expect(outcome.warnings.map((w) => [w.fieldId, w.rule])).toEqual([["n", "range"], ["yn_details", "details"], ["p", "max-files"]]);
  });
  it("enforce mode: rejects with the same list and stores nothing", () => {
    const outcome = extendedValidationOutcome(input, true);
    expect(outcome.reject).toBe(true);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.violations).toHaveLength(3);
    expect(outcome.message).toContain("Count:");
  });
  it("duplicate upload keys are counted once (as the route counts them)", () => {
    expect(extendedValidationOutcome({ ...input, answers: {}, uploads: { p: ["a", "a"] } }, true).reject).toBe(false);
  });
  it("leaves the phone's validation unchanged unless asked for the extended rules", () => {
    const base = collectFormErrors(schema, { n: 2, yn: true, req: "x" }, { p: 3 }, {});
    expect(base).toEqual([]);
    expect(collectFormErrors(schema, { n: 2, yn: true, req: "x" }, { p: 3 }, {}, undefined, false, undefined, { extended: true }).map((e) => e.rule)).toEqual(["max-files"]);
  });
  it("reads stored warnings tolerantly", () => {
    expect(readSubmissionWarnings({ __validationWarnings: [{ fieldId: "n", label: "Count", rule: "range", message: "Too high" }, "junk", { fieldId: 3 }] })).toEqual([{ fieldId: "n", label: "Count", rule: "range", message: "Too high" }]);
    expect(readSubmissionWarnings(null)).toEqual([]);
  });
});
