import { expect, it } from "vitest";
import { deriveVisionFields } from "@/lib/ai/form-fields";
it("derives visible canonical fields, excludes external references, and respects image modes", () => {
  const schema = { sections: [{ title: "Kitchen", fields: [
    { id: "photo", type: "photo", label: "Bench", maxFiles: 2, references: [{ kind: "image", storageKey: "form-references/admin/bench.png" }, { kind: "image", url: "http://external/image" }, { kind: "image", storageKey: "form-references/../secret" }] },
    { id: "hidden", type: "photo", conditional: { fieldId: "required", value: true } },
    { id: "video", type: "photo", mediaMode: "video" }, { id: "both", type: "video", mediaMode: "both" }, { id: "check", type: "checkbox" },
  ] }, { title: "Hidden room", conditional: { fieldId: "show", value: true }, fields: [{ id: "nested", type: "photo" }] }] };
  expect(deriveVisionFields(schema, {}, {}).map(field => ({ id: field.id, imageCapable: field.imageCapable }))).toEqual([{ id: "photo", imageCapable: true }, { id: "video", imageCapable: false }, { id: "both", imageCapable: true }, { id: "check", imageCapable: false }]);
  expect(deriveVisionFields(schema, {}, {})[0]).toMatchObject({ label: "Bench", sectionLabel: "Kitchen", maxFiles: 2, referenceKeys: ["form-references/admin/bench.png"] });
});
