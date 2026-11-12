// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ tx: vi.fn(), any: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx, formTemplate: { findUnique: m.any }, formTemplateVersion: { findMany: m.any } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));

import { formTemplateSchemaZ, validateFormSchemaForSave } from "@/lib/forms/template-schema";
import { toEditableSchema } from "@/lib/forms/editable-schema";
import { saveTemplateDraft } from "@/lib/forms/template-drafts";
import { assertPublishable, publishFormTemplate } from "@/lib/forms/template-publish";
import { runFormTest } from "@/lib/forms/test-run";
import { TemplateServiceError } from "@/lib/forms/template-errors";

const ok = { sections: [{ id: "s", title: "S", fields: [{ id: "f", type: "yesno", label: "Q" }] }] };
const withField = (field: Record<string, unknown>) => ({ sections: [{ id: "s", title: "S", fields: [field] }] });

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ propertyFormTemplateOverrides: {} });
});

describe("strict save check, tolerant reader", () => {
  it("accepts a valid schema, the legacy type aliases and typed cadence / repeat / property rules", () => {
    expect(validateFormSchemaForSave(ok).ok).toBe(true);
    for (const type of ["upload", "textarea", "inventory", "laundry_confirm"]) {
      expect(validateFormSchemaForSave(withField({ id: "f", type, label: "Legacy" })).ok).toBe(true);
    }
    expect(validateFormSchemaForSave(withField({ id: "f", type: "checkbox", label: "Q", frequency: "ROTATIONAL", rotationEveryNCleans: 3 })).ok).toBe(true);
    expect(validateFormSchemaForSave(withField({ id: "f", type: "checkbox", label: "Q", conditional: { propertyField: "hasBalcony", value: true } })).ok).toBe(true);
    expect(validateFormSchemaForSave({ sections: [{ id: "s", title: "Bed", repeatBy: "bedrooms", fields: [] }] }).ok).toBe(true);
  });

  it.each([
    // "table" became a real type (Wave B); "grid" never existed.
    ["an unknown question type", withField({ id: "f", type: "grid", label: "Grid" })],
    ["a rule with no target", withField({ id: "f", type: "text", label: "Q", conditional: { operator: "equals", value: 1 } })],
    ["a rule watching both", withField({ id: "f", type: "text", label: "Q", conditional: { fieldId: "x", propertyField: "hasBalcony" } })],
    ["an unknown comparison", withField({ id: "f", type: "text", label: "Q", conditional: { fieldId: "x", operator: "between" } })],
    ["a property key cleaners do not receive", withField({ id: "f", type: "text", label: "Q", conditional: { propertyField: "clientId", value: "x" } })],
    // "MONTHLY" became a real cadence (Wave B); "WEEKLY" does not exist.
    ["an unknown cadence", withField({ id: "f", type: "text", label: "Q", frequency: "WEEKLY" })],
    ["a bad rotation", withField({ id: "f", type: "text", label: "Q", frequency: "ROTATIONAL", rotationEveryNCleans: 0 })],
    ["an unknown room type", { sections: [{ id: "s", title: "S", repeatBy: "kitchens", fields: [] }] }],
  ])("refuses %s on save", (_name, schema) => {
    const result = validateFormSchemaForSave(schema);
    expect(result.ok).toBe(false);
    // ...while the tolerant reader still loads it.
    expect(formTemplateSchemaZ.safeParse(schema).success).toBe(true);
  });

  it("reads any stored legacy schema into the typed builder shape without throwing", () => {
    const legacy = { sections: [{ label: "Kitchen", fields: [{ type: "upload", label: "Photo" }, { id: "n", type: "textarea" }, null, { id: "c", type: "checkbox", label: "C", conditional: { fieldId: "n", equals: "x" } }] }], inventoryConfig: { mode: "selected", itemIds: ["a"] } };
    const editable = toEditableSchema(legacy);
    const kitchen = editable.sections.find((s) => s.title === "Kitchen")!;
    expect(kitchen.fields.map((f) => f.type)).toEqual(["photo", "longtext", "checkbox"]);
    expect(kitchen.fields[2].conditional).toEqual({ fieldId: "n", operator: "equals", value: "x" });
    expect(editable.inventoryConfig).toEqual({ mode: "selected", itemIds: ["a"] });
    expect(() => toEditableSchema(null)).not.toThrow();
  });

  it("refuses an unknown type when a draft is saved, before touching the database", async () => {
    await expect(saveTemplateDraft({ templateId: "t", schema: withField({ id: "f", type: "table", label: "Grid" }), actorId: "a" })).rejects.toMatchObject({ code: "INVALID_SCHEMA" });
    expect(m.tx).not.toHaveBeenCalled();
  });
});

describe("publish is blocked by a check error in the single publish path", () => {
  it("assertPublishable refuses duplicate question keys and accepts a clean form", () => {
    expect(() => assertPublishable(ok)).not.toThrow();
    const duplicate = { sections: [{ id: "s", title: "S", fields: [{ id: "d", type: "text", label: "A" }, { id: "d", type: "text", label: "B" }] }] };
    try {
      assertPublishable(duplicate);
      throw new Error("not refused");
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateServiceError);
      expect((error as TemplateServiceError).code).toBe("CHECKS_FAILED");
      expect((error as TemplateServiceError).issues?.length).toBeGreaterThan(0);
    }
  });

  it("publishFormTemplate refuses the draft and writes nothing", async () => {
    const writes = { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() };
    const broken = { sections: [{ id: "s", title: "S", fields: [{ id: "d", type: "text", label: "A" }, { id: "d", type: "text", label: "B" }] }] };
    m.tx.mockImplementation(async (run: (tx: unknown) => unknown) =>
      run({
        formTemplate: { findUnique: async () => ({ id: "t", schema: ok, version: 4, updatedAt: new Date(), serviceType: "GENERAL_CLEAN" }), updateMany: writes.updateMany },
        formTemplateVersion: {
          findMany: async () => [{ id: "d1", version: 4, schema: broken, name: null, serviceType: null, note: null, restoredFromVersionId: null, updatedAt: new Date() }],
          create: writes.create,
          createMany: writes.createMany,
          deleteMany: writes.deleteMany,
        },
      }),
    );
    await expect(publishFormTemplate({ templateId: "t", actorId: "a" })).rejects.toMatchObject({ code: "CHECKS_FAILED" });
    for (const write of Object.values(writes)) expect(write).not.toHaveBeenCalled();
  });
});

describe("test as cleaner (pure server check)", () => {
  it("reports blocking and warning problems per question for sample answers", () => {
    const schema = {
      standardSections: false,
      sections: [{ id: "s", title: "S", fields: [
        { id: "req", type: "text", label: "Name", required: true },
        { id: "n", type: "number", label: "Count", min: 0, max: 5 },
        { id: "bal", type: "checkbox", label: "Balcony swept", required: true, conditional: { propertyField: "hasBalcony", value: true } },
      ] }],
    };
    const result = runFormTest({ schema, answers: { n: 9 }, uploadCounts: {}, property: { hasBalcony: false, clientId: "secret" }, requiredChecklistTicksBlockSubmit: true });
    expect(result.problems.map((p) => [p.fieldId, p.level])).toEqual([["req", "blocking"], ["n", "warning"]]);
    const balcony = runFormTest({ schema, answers: { req: "x", n: 1 }, uploadCounts: {}, property: { hasBalcony: true }, requiredChecklistTicksBlockSubmit: true });
    expect(balcony.problems.map((p) => p.fieldId)).toEqual(["bal"]);
  });
});
