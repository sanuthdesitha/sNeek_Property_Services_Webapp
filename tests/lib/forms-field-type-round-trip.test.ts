import { describe, it, expect } from "vitest";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { FIELD_TYPES, formatFieldValue } from "@/lib/forms/field-types";
import type { FormField, FormFieldType } from "@/lib/forms/types";

/**
 * Every field type, with every property that type can carry, must survive the
 * read → normalize → save round-trip. The historical failure mode is a
 * normalizer that rebuilds objects from a fixed key list and silently drops
 * whatever it doesn't know about (a min/max, a stamp tag, an "allow other"),
 * which shows up much later as a builder setting that "doesn't do anything".
 */

/** One representative, fully-configured field per registered type. */
function sampleField(type: FormFieldType, index: number): FormField {
  const base: FormField = {
    id: `f-${index}-${type}`,
    type,
    label: `${type} field`,
    helpText: "help",
    instructions: "how to do this",
    placeholder: "placeholder",
    required: true,
    locationTag: "Kitchen",
    severity: "high",
    evidenceCategory: "KITCHEN",
    references: [{ kind: "image", url: "https://example.test/a.jpg", storageKey: "k/a.jpg", caption: "cap" }],
    showExampleOnTick: false,
    conditional: { fieldId: "trigger", operator: "equals", value: true },
    scoring: { weight: 2, max: 1 },
  };
  const def = FIELD_TYPES[type];
  const extra: Partial<FormField> = {};
  if (def.hasOptions) Object.assign(extra, { options: ["A", "B"], allowOther: true, searchable: true });
  if (def.hasRange) Object.assign(extra, { min: 1, max: 9, step: 0.5, unit: "u" });
  if (def.isUpload) {
    Object.assign(extra, {
      minPhotos: 2,
      maxFiles: 5,
      mediaMode: "both" as const,
      stampTag: "before" as const,
    });
  }
  if (type === "yesno") Object.assign(extra, { includeNa: true, detailsWhenNo: true });
  return { ...base, ...extra };
}

const ALL_TYPES = Object.keys(FIELD_TYPES) as FormFieldType[];

describe("normalizeFormSchema — per-field-type property round-trip", () => {
  for (const [index, type] of ALL_TYPES.entries()) {
    it(`preserves every property of a "${type}" field`, () => {
      const field = sampleField(type, index);
      const out = normalizeFormSchema({
        sections: [{ id: "s1", title: "Section", fields: [field] }],
      });
      const section = out.sections.find((s: any) => s.id === "s1");
      const round = section.fields.find((f: any) => f.id === field.id);
      expect(round).toBeTruthy();

      for (const [key, value] of Object.entries(field)) {
        if (key === "conditional") continue; // canonicalised, asserted below
        expect({ key, value: round[key] }).toEqual({ key, value });
      }
      // The conditional keeps its operator + value (only the legacy shape is rewritten).
      expect(round.conditional).toEqual({ fieldId: "trigger", operator: "equals", value: true });
    });
  }

  it("drops the retired `maxDurationSec` key without erroring on older templates", () => {
    // Backward compat: `maxDurationSec` was a builder setting nothing enforced.
    // Templates saved before its removal still carry it — they must keep loading
    // (no throw, everything else intact) and the stale key must be dropped.
    const out = normalizeFormSchema({
      sections: [
        {
          id: "s1",
          title: "Arrival",
          fields: [
            {
              id: "walkthrough",
              type: "video",
              label: "Walkthrough",
              required: true,
              maxFiles: 3,
              maxDurationSec: 120,
              children: [
                { id: "clip", type: "video", label: "Extra clip", maxDurationSec: 45 },
              ],
            },
          ],
        },
      ],
    });
    const field = out.sections.find((s: any) => s.id === "s1").fields[0];
    expect("maxDurationSec" in field).toBe(false);
    expect("maxDurationSec" in field.children[0]).toBe(false);
    // Everything the field legitimately carries survives.
    expect(field.type).toBe("video");
    expect(field.required).toBe(true);
    expect(field.maxFiles).toBe(3);
  });

  it("preserves sub-field (children) properties one level deep", () => {
    const out = normalizeFormSchema({
      sections: [
        {
          id: "s1",
          title: "Section",
          fields: [
            {
              id: "parent",
              type: "yesno",
              label: "Parent",
              children: [
                {
                  id: "child",
                  type: "multiselect",
                  label: "Child",
                  options: ["A", "B"],
                  allowOther: true,
                  required: true,
                  conditional: { fieldId: "parent", equals: true },
                },
              ],
            },
          ],
        },
      ],
    });
    const child = out.sections.find((s: any) => s.id === "s1").fields[0].children[0];
    expect(child.options).toEqual(["A", "B"]);
    expect(child.allowOther).toBe(true);
    expect(child.required).toBe(true);
    // legacy {equals} → {operator,value} for children too
    expect(child.conditional).toEqual({ fieldId: "parent", operator: "equals", value: true });
  });

  it("preserves section-level properties (description, collapsible, conditional)", () => {
    const out = normalizeFormSchema({
      sections: [
        {
          id: "s1",
          title: "Section",
          description: "desc",
          collapsible: true,
          conditional: { fieldId: "t", operator: "notEquals", value: "x" },
          fields: [],
        },
      ],
    });
    const section = out.sections.find((s: any) => s.id === "s1");
    expect(section.description).toBe("desc");
    expect(section.collapsible).toBe(true);
    expect(section.conditional).toEqual({ fieldId: "t", operator: "notEquals", value: "x" });
  });

  it("carries unknown root-level schema keys through the round-trip", () => {
    const out = normalizeFormSchema({
      sections: [{ id: "s1", title: "S", fields: [] }],
      theme: { accentColor: "#123456" },
      inventoryConfig: { mode: "selected", itemIds: ["i1"] },
      // forward-compatible root config the normalizer has never heard of
      futureSetting: { enabled: true },
    } as any);
    expect(out.theme).toEqual({ accentColor: "#123456" });
    expect(out.inventoryConfig).toEqual({ mode: "selected", itemIds: ["i1"] });
    expect((out as any).futureSetting).toEqual({ enabled: true });
  });

  it("stays idempotent with the full field set", () => {
    const schema = {
      sections: [
        { id: "s1", title: "S", fields: ALL_TYPES.map((t, i) => sampleField(t, i)) },
      ],
    };
    const once = normalizeFormSchema(schema);
    const twice = normalizeFormSchema(once);
    expect(JSON.stringify(twice)).toEqual(JSON.stringify(once));
  });
});

describe("formatFieldValue — per-type display", () => {
  const field = (type: FormFieldType, extra: Partial<FormField> = {}): FormField =>
    ({ id: "x", type, label: "l", ...extra }) as FormField;

  it("formats yes/no answers stored as booleans AND as legacy strings", () => {
    expect(formatFieldValue(field("yesno"), true)).toBe("Yes");
    expect(formatFieldValue(field("yesno"), false)).toBe("No");
    expect(formatFieldValue(field("yesno"), "yes")).toBe("Yes");
    expect(formatFieldValue(field("yesno"), "no")).toBe("No");
    expect(formatFieldValue(field("yesno"), "na")).toBe("N/A");
    expect(formatFieldValue(field("yesno"), undefined)).toBe("-");
  });

  it("formats checkbox, multiselect, number+unit, currency, location and signature", () => {
    expect(formatFieldValue(field("checkbox"), true)).toBe("Yes");
    expect(formatFieldValue(field("multiselect"), ["A", "B"])).toBe("A, B");
    expect(formatFieldValue(field("multiselect"), [])).toBe("-");
    expect(formatFieldValue(field("number", { unit: "min" }), 12)).toBe("12 min");
    expect(formatFieldValue(field("currency"), 12.5)).toBe("$12.50");
    expect(formatFieldValue(field("location"), { lat: 1.234567, lng: 2.345678 })).toBe("1.23457, 2.34568");
    expect(formatFieldValue(field("signature"), "data:image/png;base64,xx")).toBe("Signed");
    expect(formatFieldValue(field("signature"), "")).toBe("-");
    expect(formatFieldValue(field("instruction"), "anything")).toBe("-");
  });

  it("rating/slider/scale/counter/temperature read as numbers with their unit", () => {
    expect(formatFieldValue(field("rating"), 4)).toBe("4");
    expect(formatFieldValue(field("slider", { unit: "%" }), 30)).toBe("30 %");
    expect(formatFieldValue(field("scale"), 0)).toBe("0");
    expect(formatFieldValue(field("counter"), 3)).toBe("3");
    expect(formatFieldValue(field("temperature", { unit: "°C" }), 4.5)).toBe("4.5 °C");
  });
});
