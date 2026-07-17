import { describe, it, expect } from "vitest";
import { isTemplateConditionalMet } from "@/lib/forms/visibility";

// Regression: an "Exception evidence" photo field is revealed by a multiselect
// "reported-exceptions" trigger via operator "oneOf". The answer is an array;
// selecting a SECOND option used to hide the evidence field (String([a,b]) never
// equals a scalar). The evaluator must treat array answers as membership.
const EXC = "reported-exceptions";

describe("isTemplateConditionalMet — multiselect (array) answers", () => {
  const cond = (operator: string, value: unknown) => ({ fieldId: EXC, operator, value });

  it("oneOf fires when the single-element expected label is among MULTIPLE selections", () => {
    const c = cond("oneOf", ["Damage to property or contents"]);
    expect(isTemplateConditionalMet(c, { [EXC]: ["Damage to property or contents"] }, {})).toBe(true);
    // The regression case: two selected → still visible.
    expect(
      isTemplateConditionalMet(c, { [EXC]: ["Mould or mildew", "Damage to property or contents"] }, {}),
    ).toBe(true);
    // Not selected → hidden.
    expect(isTemplateConditionalMet(c, { [EXC]: ["Mould or mildew"] }, {})).toBe(false);
    expect(isTemplateConditionalMet(c, { [EXC]: [] }, {})).toBe(false);
  });

  it("equals treats an array answer as contains", () => {
    const c = cond("equals", "Damage to property or contents");
    expect(isTemplateConditionalMet(c, { [EXC]: ["A", "Damage to property or contents"] }, {})).toBe(true);
    expect(isTemplateConditionalMet(c, { [EXC]: ["A", "B"] }, {})).toBe(false);
  });

  it("notEquals is true only when the value is absent from the selections", () => {
    const c = cond("notEquals", "Damage to property or contents");
    expect(isTemplateConditionalMet(c, { [EXC]: ["A", "B"] }, {})).toBe(true);
    expect(isTemplateConditionalMet(c, { [EXC]: ["A", "Damage to property or contents"] }, {})).toBe(false);
  });

  it("scalar answers keep the original behaviour", () => {
    expect(isTemplateConditionalMet(cond("equals", "yes"), { [EXC]: "yes" }, {})).toBe(true);
    expect(isTemplateConditionalMet(cond("equals", "yes"), { [EXC]: "no" }, {})).toBe(false);
    expect(isTemplateConditionalMet(cond("oneOf", ["a", "b"]), { [EXC]: "b" }, {})).toBe(true);
  });
});
