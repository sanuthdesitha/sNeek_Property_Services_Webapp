// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Use the real pure rework builder without allowing its neighboring services
// to reach persistence, settings, or image providers.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(() => { throw new Error("Unexpected settings access"); }) }));
vi.mock("@/lib/qa/annotation-composite", () => ({ compositeAnnotated: vi.fn(() => { throw new Error("Unexpected image access"); }) }));

import { assembleJobForm } from "@/lib/forms/assemble-job-form";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { collectRequiredAnswerFields, collectRequiredUploadFields } from "@/lib/forms/visibility";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { buildReworkFormSchema } from "@/lib/qa/rework-jobs";

const extras = [
  { id: "oven-extra", label: "<b>Oven &amp; trays</b>", instructions: "<p>Remove trays</p><p>Wipe clean</p>" },
  { id: "windows-extra", label: "Windows" },
];
const legacy = {
  standardSections: false,
  theme: { logoKey: "logo.png", logoUrl: "https://example.test/signed-logo", accentColor: "#123456" },
  inventoryConfig: { mode: "selected", itemIds: ["soap"] },
  customRoot: { futureOption: true },
  sections: [{
    label: "Kitchen", fields: [
      { id: "photo", type: "upload", label: "Evidence", required: true, references: [{ kind: "image", storageKey: "reference.jpg", url: "https://example.test/signed-ref" }] },
      { id: "note", type: "textarea", label: "Note", required: true },
      { id: "detail", type: "text", label: "Detail", required: true, conditional: { fieldId: "trigger", equals: true } },
      { id: "group", type: "instruction", children: [{ type: "upload", label: "Child evidence", required: true }] },
    ],
  }],
};
const ids = (fields: { id: string }[]) => fields.map((field) => field.id).sort();

describe("assembleJobForm", () => {
  it("preserves section and additional IDs/order, sanitizes quote text and leaves extras optional", () => {
    const result = assembleJobForm(legacy, extras);
    expect(result.sections.map((section) => section.id)).toEqual(["kitchen", "additionals"]);
    expect(result.sections[1]).toEqual({
      id: "additionals", title: "Additionals (client-requested)",
      description: "Extra work added on the quote for this job.",
      fields: [
        { id: "oven-extra", type: "checkbox", label: "Oven & trays", instructions: "Remove trays\nWipe clean", required: false },
        { id: "windows-extra", type: "checkbox", label: "Windows", instructions: undefined, required: false },
      ],
    });
    expect(ids(collectRequiredAnswerFields(result, {}, {}, { requiredChecklistTicksBlockSubmit: true }))).not.toContain("oven-extra");
  });

  it.each([false, true])("legacy answer/upload collectors match the rendered form with conditional trigger=%s", (trigger) => {
    const schema = assembleJobForm(legacy, extras);
    const answers = { trigger };
    const uploadIds = ids(collectRequiredUploadFields(schema, answers, {}));
    const answerIds = ids(collectRequiredAnswerFields(schema, answers, {}, { requiredChecklistTicksBlockSubmit: true }));
    expect(uploadIds).toEqual(["group.field-0", "photo"]);
    expect(answerIds).toEqual(trigger ? ["detail", "note"] : ["note"]);
    expect(collectFormErrors(schema, answers, {}, {}, undefined, true).map((error) => error.fieldId).sort())
      .toEqual([...uploadIds, ...answerIds].sort());
    expect(collectFormErrors(schema, { trigger, detail: "done", note: "done" }, { photo: 1, "group.field-0": 1 }, {}, undefined, true)).toEqual([]);
  });

  it("retains root config and references, normalizes aliases/children, and does not mutate inputs", () => {
    const before = JSON.stringify({ legacy, extras });
    const result = assembleJobForm(legacy, extras);
    expect(result).toMatchObject({ standardSections: false, theme: legacy.theme, inventoryConfig: legacy.inventoryConfig, customRoot: legacy.customRoot });
    expect(result.sections[0].fields[0]).toMatchObject({ id: "photo", type: "photo", references: legacy.sections[0].fields[0].references });
    expect(result.sections[0].fields[1].type).toBe("longtext");
    expect(result.sections[0].fields[2].conditional).toEqual({ fieldId: "trigger", operator: "equals", value: true });
    expect(result.sections[0].fields[3].children[0]).toMatchObject({ id: "group.field-0", type: "photo" });
    expect(JSON.stringify({ legacy, extras })).toBe(before);
    expect(normalizeFormSchema(result)).toEqual(result);
    expect(assembleJobForm(result)).toEqual(result);
  });

  it.each([true, false])("normalizes real generated rework schemas and collector parity (categorized=%s)", (categorized) => {
    const generated = buildReworkFormSchema([{ id: "kitchen", label: "Kitchen", photoKeys: ["qa.jpg"] }], { categorized });
    const assembled = assembleJobForm(generated, extras);
    const baseline = normalizeFormSchema(generated);
    // Standard sections are the existing normalizer's rules, not new fields
    // introduced by this assembler. Quote extras add no required answers.
    expect(ids(collectRequiredUploadFields(assembled, {}, {}))).toEqual(ids(collectRequiredUploadFields(baseline, {}, {})));
    expect(ids(collectRequiredUploadFields(assembled, {}, {}))).toContain("rework_area_kitchen");
    expect(ids(collectRequiredAnswerFields(assembled, {}, {}, { requiredChecklistTicksBlockSubmit: true })))
      .toEqual(ids(collectRequiredAnswerFields(baseline, {}, {}, { requiredChecklistTicksBlockSubmit: true })));
    const missingFromCollectors = [
      ...ids(collectRequiredUploadFields(assembled, {}, {})),
      ...ids(collectRequiredAnswerFields(assembled, {}, {}, { requiredChecklistTicksBlockSubmit: true })),
    ];
    const missingInUi = collectFormErrors(assembled, {}, {}, {}, undefined, true).map((error) => error.fieldId);
    expect(new Set(missingInUi)).toEqual(new Set(missingFromCollectors));
    expect(normalizeFormSchema(assembled)).toEqual(assembled);
    const originalIds = generated.sections.map((section) => section.id);
    const retainedOrder = assembled.sections.map((section) => section.id).filter((id) => originalIds.includes(id) || id === "additionals");
    expect(retainedOrder).toEqual([...originalIds, "additionals"]);
  });

  it("keeps fields needed by the report schema snapshot, including optional additional answers", () => {
    // This exercises the schema's persisted JSON representation, not a DB
    // submission. The route stores this value at data.__templateSchema.
    const snapshot = JSON.parse(JSON.stringify(assembleJobForm(legacy, extras)));
    const fields = snapshot.sections.flatMap((section: { fields: { id: string; label: string }[] }) => section.fields);
    expect(fields.find((field: { id: string }) => field.id === "oven-extra")).toMatchObject({
      type: "checkbox", required: false, label: "Oven & trays", instructions: "Remove trays\nWipe clean",
    });
    expect(fields.find((field: { id: string }) => field.id === "photo")).toMatchObject({ type: "photo", label: "Evidence" });
    expect(snapshot.customRoot).toEqual(legacy.customRoot);
  });

  it("supports additionals-only schema without changing template availability rules", () => {
    const schema = assembleJobForm(null, extras);
    expect(schema.sections.find((section) => section.id === "additionals").fields.map((field: { id: string }) => field.id))
      .toEqual(["oven-extra", "windows-extra"]);
    expect(assembleJobForm(null)).toEqual(normalizeFormSchema(null));
  });
});
