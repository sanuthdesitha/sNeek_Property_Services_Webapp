// @vitest-environment node
/** "Camera not working — ask the office": which blockers an office decision waives, and nothing else. */
import { describe, expect, it } from "vitest";
import { allowedFieldsOf, officeAllowedFieldIds, pairFields, uploadFieldIdsOf, withoutAllowedUploads } from "@/lib/jobs/evidence-override-rules";

const schema = {
  sections: [
    { id: "k", fields: [{ id: "bench", type: "photo" }, { id: "note", type: "text" }, { id: "q", type: "yesno", children: [{ id: "child-video", type: "video" }] }] },
    { id: "l", fields: [{ id: "legacy", type: "upload" }] },
  ],
};

describe("evidence override rules", () => {
  it("finds the form's upload questions, children and the legacy alias included", () => {
    expect(Array.from(uploadFieldIdsOf(schema)).sort()).toEqual(["bench", "child-video", "legacy"]);
    expect(uploadFieldIdsOf(null).size).toBe(0);
  });

  it("unions only ALLOWED requests", () => {
    expect(allowedFieldsOf([
      { status: "ALLOWED", allowedFieldIds: ["b", "a"] },
      { status: "DECLINED", allowedFieldIds: ["x"] },
      { status: "REQUESTED", allowedFieldIds: ["y"] },
      { status: "ALLOWED", allowedFieldIds: ["a"] },
    ])).toEqual(["a", "b"]);
  });

  it("waives only missing-upload blockers of allowed questions, never an answer with the same id", () => {
    const uploads = uploadFieldIdsOf(schema);
    const errors = [{ fieldId: "bench" }, { fieldId: "note" }, { fieldId: "legacy" }];
    expect(withoutAllowedUploads(errors, ["bench", "note"], uploads)).toEqual([{ fieldId: "note" }, { fieldId: "legacy" }]);
    expect(withoutAllowedUploads(errors, [], uploads)).toEqual(errors);
  });

  it("reads the payload defensively and pairs labels", () => {
    expect(officeAllowedFieldIds({ evidenceOverride: { allowedFieldIds: ["a", 3, "b"] } })).toEqual(["a", "b"]);
    expect(officeAllowedFieldIds({ evidenceOverride: { allowedFieldIds: "a" } })).toEqual([]);
    expect(officeAllowedFieldIds(null)).toEqual([]);
    expect(pairFields(["a", "b"], ["Bench"])).toEqual([{ fieldId: "a", label: "Bench" }, { fieldId: "b", label: "b" }]);
  });
});
