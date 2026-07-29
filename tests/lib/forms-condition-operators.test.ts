import { describe, it, expect } from "vitest";
import {
  isTemplateConditionalMet,
  isFlattenedFieldVisible,
  flattenFieldsOneLevel,
  templateValuesEqual,
} from "@/lib/forms/visibility";

/**
 * The condition engine, exercised per SOURCE field type. A rule is authored in
 * the builder against a field type and evaluated against however that type
 * stores its answer — boolean for yes/no + checkbox, array for multi-select,
 * number for the scale family, string for text/choice. Mismatches here are
 * invisible in the builder and fatal in the field (the reveal never happens).
 */

const cond = (fieldId: string, operator: string, value?: unknown) =>
  value === undefined ? { fieldId, operator } : { fieldId, operator, value };
const met = (c: any, answers: Record<string, unknown>) => isTemplateConditionalMet(c, answers, {});

describe("condition source: yes/no (boolean answers)", () => {
  it("equals true / false fires on the boolean the renderer stores", () => {
    expect(met(cond("q", "equals", true), { q: true })).toBe(true);
    expect(met(cond("q", "equals", true), { q: false })).toBe(false);
    expect(met(cond("q", "equals", false), { q: false })).toBe(true);
  });

  it("also fires for legacy \"yes\"/\"no\" string answers", () => {
    expect(met(cond("q", "equals", true), { q: "yes" })).toBe(true);
    expect(met(cond("q", "equals", false), { q: "no" })).toBe(true);
    expect(met(cond("q", "equals", true), { q: "no" })).toBe(false);
  });

  it("an UNANSWERED yes/no satisfies neither equals true nor equals false", () => {
    expect(met(cond("q", "equals", true), {})).toBe(false);
    expect(met(cond("q", "equals", false), {})).toBe(false);
  });

  it("N/A is neither Yes nor No, but counts as answered", () => {
    expect(met(cond("q", "equals", true), { q: "na" })).toBe(false);
    expect(met(cond("q", "equals", false), { q: "na" })).toBe(false);
    expect(met(cond("q", "answered"), { q: "na" })).toBe(true);
  });

  it("notEquals is the inverse of equals for answered values", () => {
    expect(met(cond("q", "notEquals", true), { q: false })).toBe(true);
    expect(met(cond("q", "notEquals", true), { q: true })).toBe(false);
  });
});

describe("condition source: checkbox", () => {
  it("ticked / unticked compare as booleans", () => {
    expect(met(cond("c", "equals", true), { c: true })).toBe(true);
    expect(met(cond("c", "equals", true), { c: false })).toBe(false);
    expect(met(cond("c", "equals", false), { c: false })).toBe(true);
  });
  it("answered/notAnswered treat an explicit false as answered", () => {
    expect(met(cond("c", "answered"), { c: false })).toBe(true);
    expect(met(cond("c", "notAnswered"), {})).toBe(true);
  });
});

describe("condition source: multi-select (array answers)", () => {
  const A = "Damage";
  const B = "Mould";

  it("equals / contains both mean membership", () => {
    expect(met(cond("m", "equals", A), { m: [A, B] })).toBe(true);
    expect(met(cond("m", "contains", A), { m: [A, B] })).toBe(true);
    expect(met(cond("m", "contains", A), { m: [B] })).toBe(false);
  });

  it("notContains / notEquals mean 'not among the selections'", () => {
    expect(met(cond("m", "notContains", A), { m: [B] })).toBe(true);
    expect(met(cond("m", "notContains", A), { m: [A, B] })).toBe(false);
    expect(met(cond("m", "notEquals", A), { m: [B] })).toBe(true);
  });

  it("oneOf fires when ANY listed value is selected", () => {
    expect(met(cond("m", "oneOf", [A, "Other"]), { m: [B, A] })).toBe(true);
    expect(met(cond("m", "oneOf", [A]), { m: [B] })).toBe(false);
  });

  it("an empty / unset multi-select answers nothing", () => {
    expect(met(cond("m", "contains", A), { m: [] })).toBe(false);
    expect(met(cond("m", "contains", A), {})).toBe(false);
    expect(met(cond("m", "answered"), { m: [] })).toBe(false);
    expect(met(cond("m", "notAnswered"), { m: [] })).toBe(true);
    // "does not include" is true when nothing is selected.
    expect(met(cond("m", "notContains", A), { m: [] })).toBe(true);
  });
});

describe("condition source: select / radio / text", () => {
  it("equals matches the option string exactly", () => {
    expect(met(cond("s", "equals", "Pyrolytic"), { s: "Pyrolytic" })).toBe(true);
    expect(met(cond("s", "equals", "Pyrolytic"), { s: "Gas" })).toBe(false);
  });
  it("oneOf accepts a list of options", () => {
    expect(met(cond("s", "oneOf", ["Gas", "Electric"]), { s: "Electric" })).toBe(true);
    expect(met(cond("s", "oneOf", ["Gas", "Electric"]), { s: "Induction" })).toBe(false);
  });
  it("contains is a case-insensitive substring test for free text", () => {
    expect(met(cond("t", "contains", "leak"), { t: "Small LEAK under sink" })).toBe(true);
    expect(met(cond("t", "notContains", "leak"), { t: "All good" })).toBe(true);
    expect(met(cond("t", "contains", "leak"), {})).toBe(false);
  });
  it("empty string counts as unanswered", () => {
    expect(met(cond("t", "answered"), { t: "   " })).toBe(false);
    expect(met(cond("t", "notAnswered"), { t: "" })).toBe(true);
  });
});

describe("condition source: numeric (number / rating / slider / scale / counter)", () => {
  it("gt / lt compare numerically, including string-typed answers", () => {
    expect(met(cond("n", "gt", 3), { n: 5 })).toBe(true);
    expect(met(cond("n", "gt", 3), { n: "5" })).toBe(true);
    expect(met(cond("n", "lt", 3), { n: 2 })).toBe(true);
    expect(met(cond("n", "lt", 3), { n: 3 })).toBe(false);
  });

  it("a non-numeric or missing answer satisfies neither gt nor lt", () => {
    expect(met(cond("n", "gt", 3), {})).toBe(false);
    expect(met(cond("n", "lt", 3), {})).toBe(false);
    expect(met(cond("n", "gt", 3), { n: "" })).toBe(false);
    expect(met(cond("n", "lt", 3), { n: "abc" })).toBe(false);
  });

  it("zero is a real answer, not an empty one", () => {
    expect(met(cond("n", "equals", 0), { n: 0 })).toBe(true);
    expect(met(cond("n", "answered"), { n: 0 })).toBe(true);
    expect(met(cond("n", "lt", 1), { n: 0 })).toBe(true);
  });
});

describe("no rule / property rules / defaults", () => {
  it("a field with no conditional is always visible", () => {
    expect(isTemplateConditionalMet(undefined, {}, {})).toBe(true);
    expect(isTemplateConditionalMet(null, {}, {})).toBe(true);
  });
  it("a missing operator defaults to equals", () => {
    expect(met({ fieldId: "q", value: "x" } as any, { q: "x" })).toBe(true);
  });
  it("legacy { equals } shape still works", () => {
    expect(met({ fieldId: "q", equals: true } as any, { q: true })).toBe(true);
  });
  it("property-field rules compare against the property, not the answers", () => {
    expect(isTemplateConditionalMet({ propertyField: "hasBalcony", value: true }, {}, { hasBalcony: true })).toBe(true);
    expect(isTemplateConditionalMet({ propertyField: "hasBalcony", value: true }, {}, { hasBalcony: false })).toBe(false);
  });
});

describe("condition TARGET: every field type can be revealed, including sub-fields", () => {
  const fields = [
    { id: "trigger", type: "yesno", label: "Damage?" },
    { id: "t-text", type: "text", label: "Where", conditional: { fieldId: "trigger", operator: "equals", value: true } },
    { id: "t-photo", type: "photo", label: "Photos", conditional: { fieldId: "trigger", operator: "equals", value: true } },
    { id: "t-multi", type: "multiselect", label: "Kinds", options: ["A"], conditional: { fieldId: "trigger", operator: "equals", value: true } },
    { id: "t-sig", type: "signature", label: "Sign", conditional: { fieldId: "trigger", operator: "equals", value: true } },
    {
      id: "t-parent",
      type: "checkbox",
      label: "Parent",
      conditional: { fieldId: "trigger", operator: "equals", value: true },
      children: [{ id: "t-child", type: "text", label: "Child" }],
    },
  ];

  it("targets stay hidden until the trigger fires, and children inherit the parent's rule", () => {
    const flat = flattenFieldsOneLevel(fields);
    const hidden = flat.filter((f: any) => isFlattenedFieldVisible(f, {}, {})).map((f: any) => f.id);
    expect(hidden).toEqual(["trigger"]);

    const shown = flat.filter((f: any) => isFlattenedFieldVisible(f, { trigger: true }, {})).map((f: any) => f.id);
    expect(shown).toEqual(["trigger", "t-text", "t-photo", "t-multi", "t-sig", "t-parent", "t-child"]);
  });
});

describe("templateValuesEqual", () => {
  it("bridges booleans, yes/no strings and numbers without false positives", () => {
    expect(templateValuesEqual(true, "true")).toBe(true);
    expect(templateValuesEqual(true, "yes")).toBe(true);
    expect(templateValuesEqual(false, "no")).toBe(true);
    expect(templateValuesEqual(false, undefined)).toBe(false);
    expect(templateValuesEqual(true, "na")).toBe(false);
    expect(templateValuesEqual(5, "5")).toBe(true);
    expect(templateValuesEqual("A", "A")).toBe(true);
  });
});
