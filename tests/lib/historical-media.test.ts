import { expect, it } from "vitest";
import { getHistoricalSubmissionFields, isHistoricalSubmissionImageKey, resolveHistoricalMediaField } from "@/lib/ai/historical-media";
const schema = { sections: [{ id: "bedroom", title: "Bedroom one", fields: [{ id: "bed-made", type: "checkbox", label: "Bed made", children: [{ id: "linen", type: "yesno", label: "Linen checked" }] }] }] };
const submission = { jobId: "job", submittedById: "cleaner", data: {}, template: { schema } };
const photo = { fieldId: "bed-made", mediaType: "PHOTO", s3Key: "jobs/job/cleaner/photo.jpg" };
it("resolves legacy report photos through the linked template including checkbox and child evidence", () => {
  expect(getHistoricalSubmissionFields(submission)).toEqual([{ id: "bed-made", label: "Bed made", sectionLabel: "Bedroom one" }, { id: "linen", label: "Linen checked", sectionLabel: "Bedroom one" }]);
  expect(resolveHistoricalMediaField(submission, photo)).toMatchObject({ id: "bed-made", label: "Bed made" });
  expect(resolveHistoricalMediaField(submission, { ...photo, fieldId: "linen" })).toMatchObject({ id: "linen" });
});
it("uses the submitted snapshot over a changed linked template and never falls through an empty snapshot", () => {
  const current = { ...submission, data: { __templateSchema: { sections: [{ title: "Old room", fields: [{ id: "bed-made", label: "Original label", type: "photo" }] }] } } };
  expect(resolveHistoricalMediaField(current, photo)).toMatchObject({ label: "Original label", sectionLabel: "Old room" });
  expect(getHistoricalSubmissionFields({ ...submission, data: { __templateSchema: {} } })).toEqual([]);
});
it("does not invent destinations for unlabelled report leftovers or duplicate canonical IDs", () => {
  expect(resolveHistoricalMediaField(submission, { ...photo, fieldId: "unassigned-pool" })).toBeNull();
  expect(resolveHistoricalMediaField({ ...submission, template: null }, photo)).toBeNull();
  expect(resolveHistoricalMediaField(submission, { ...photo, mediaType: "VIDEO" })).toBeNull();
  expect(resolveHistoricalMediaField({ ...submission, template: { schema: { sections: [schema.sections[0], schema.sections[0]] } } }, photo)).toBeNull();
});
it.each(["jobs/job/cleaner/photo.jpg", "forms/job/capture/cleaner/photo.jpg", "forms/cleaner/photo.jpg"])("recognizes actual historical cleaner storage layout %s", key => {
  expect(isHistoricalSubmissionImageKey(key, "job", "cleaner")).toBe(true);
});
it.each(["jobs/other/cleaner/photo.jpg", "forms/other/photo.jpg", "uploads/cleaner/photo.jpg", "https://example.test/photo.jpg", "jobs/job/../photo.jpg", "jobs/job/cleaner\\photo.jpg", "jobs/job//photo.jpg"])("rejects unscoped or unsafe paths %s", key => {
  expect(isHistoricalSubmissionImageKey(key, "job", "cleaner")).toBe(false);
});
it("does not accept actor-only legacy forms without a matching submitted-by identity", () => {
  expect(isHistoricalSubmissionImageKey("forms/cleaner/photo.jpg", "job")).toBe(false);
});
