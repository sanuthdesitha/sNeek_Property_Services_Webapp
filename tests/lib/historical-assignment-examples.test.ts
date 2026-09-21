import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ submissions: vi.fn(), latest: vi.fn(), memory: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { formSubmission: { findMany: mocks.submissions, findFirst: mocks.latest }, appSetting: { findUnique: mocks.memory } } }));
import { getHistoricalAssignmentExamples, readPropertyTrainingExamples } from "@/lib/ai/historical-assignment-examples";
const fields = [{ id: "bed1", label: "Bed photo", sectionLabel: "Bedroom one" }, { id: "bed2", label: "Bed photo", sectionLabel: "Bedroom two" }];
function submission(jobId: string, fieldList = fields, patch = {}) {
  return { id: `submission-${jobId}`, jobId, createdAt: new Date("2026-09-20"), job: { propertyId: "property", status: "COMPLETED" },
    data: { __templateSchema: { sections: fieldList.map(field => ({ title: field.sectionLabel, fields: [{ id: field.id, label: field.label, type: "photo" }] })) } },
    media: fieldList.map(field => ({ id: `${jobId}-${field.id}`, fieldId: field.id, mediaType: "PHOTO", s3Key: `forms/${jobId}/${field.id}.jpg` })), ...patch };
}
const input = { propertyId: "property", currentJobId: "current", fields, maxImages: 20 };
beforeEach(() => { vi.clearAllMocks(); mocks.memory.mockResolvedValue(null); mocks.submissions.mockResolvedValue([]); });
it("queries only the authorized property and final prior jobs with bounded recency", async () => {
  mocks.submissions.mockResolvedValue([submission("prior")]);
  const result = await getHistoricalAssignmentExamples(input);
  expect(result.examples).toHaveLength(2);
  expect(mocks.submissions).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: { not: "current" }, job: { propertyId: "property", status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] } } }, take: 100, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
  expect(result.examples[0]).toMatchObject({ sourceJobId: "prior", sourceSubmissionId: "submission-prior", fieldId: "bed1", fieldLabel: "Bed photo", sectionLabel: "Bedroom one" });
});
it("rejects cross-property/current/cancelled evidence even if supplied by a faulty data source", async () => {
  mocks.submissions.mockResolvedValue([submission("current"), submission("other", fields, { job: { propertyId: "other-property", status: "COMPLETED" } }), submission("cancelled", fields, { job: { propertyId: "property", status: "CANCELLED" } })]);
  expect((await getHistoricalAssignmentExamples(input)).examples).toEqual([]);
});
it("samples two distinct recent jobs per field and shares a small budget across rooms", async () => {
  mocks.submissions.mockResolvedValue([submission("new"), submission("middle"), submission("old")]);
  expect((await getHistoricalAssignmentExamples(input)).examples.map(row => row.mediaId)).toEqual(["new-bed1", "new-bed2", "middle-bed1", "middle-bed2"]);
  expect((await getHistoricalAssignmentExamples({ ...input, maxImages: 2 })).examples.map(row => row.mediaId)).toEqual(["new-bed1", "new-bed2"]);
});
it("uses only the latest submission per historical job, including empty replacements", async () => {
  mocks.submissions.mockResolvedValue([submission("prior", fields, { media: [] }), submission("prior")]);
  expect((await getHistoricalAssignmentExamples(input)).examples).toEqual([]);
});
it("permits a changed field ID only for unique exact normalized label and section", async () => {
  mocks.submissions.mockResolvedValue([submission("prior", [{ id: "old", label: "  BED   PHOTO ", sectionLabel: "bedroom ONE" }])]);
  expect((await getHistoricalAssignmentExamples(input)).examples.map(row => row.fieldId)).toEqual(["bed1"]);
});
it("does not reuse repurposed IDs or guess between ambiguous same-label rooms", async () => {
  mocks.submissions.mockResolvedValue([submission("prior", [{ ...fields[0], sectionLabel: "Bathroom" }])]);
  expect((await getHistoricalAssignmentExamples(input)).examples).toEqual([]);
  mocks.submissions.mockResolvedValue([submission("prior", [{ ...fields[0], id: "old" }])]);
  expect((await getHistoricalAssignmentExamples({ ...input, fields: [fields[0], { ...fields[0], id: "duplicate-label" }] })).examples).toEqual([]);
});
it("rejects ambiguous historical labels, missing sections, and duplicate canonical IDs", async () => {
  mocks.submissions.mockResolvedValue([submission("prior", [{ ...fields[0], id: "old1" }, { ...fields[0], id: "old2" }])]);
  expect((await getHistoricalAssignmentExamples(input)).examples).toEqual([]);
  mocks.submissions.mockResolvedValue([submission("prior", [{ id: "old", label: "Bed photo", sectionLabel: "" }])]);
  expect((await getHistoricalAssignmentExamples({ ...input, fields: [{ ...fields[0], sectionLabel: "" }] })).examples).toEqual([]);
  await expect(getHistoricalAssignmentExamples({ ...input, fields: [fields[0], fields[0]] })).rejects.toThrow("scope");
});
it("excludes unassigned/task/video/cross-job keys and missing canonical snapshots", async () => {
  const prior = submission("prior"); prior.media = [
    { ...prior.media[0], fieldId: "__bulkPool" }, { ...prior.media[0], fieldId: "task-proof" },
    { ...prior.media[0], mediaType: "VIDEO" }, { ...prior.media[0], s3Key: "forms/foreign/photo.jpg" },
  ];
  mocks.submissions.mockResolvedValue([prior, submission("legacy", fields, { data: {} })]);
  expect((await getHistoricalAssignmentExamples(input)).examples).toEqual([]);
});
it("exclusions remove images and invalidate snapshot even when excluded image is outside sample", async () => {
  mocks.submissions.mockResolvedValue([submission("prior")]);
  const original = await getHistoricalAssignmentExamples(input);
  mocks.memory.mockResolvedValue({ value: { excludedMediaIds: ["prior-bed1", "older-unselected"] } });
  const excluded = await getHistoricalAssignmentExamples(input);
  expect(excluded.examples.map(row => row.mediaId)).toEqual(["prior-bed2"]);
  expect(excluded.exclusionsFingerprint).not.toBe(original.exclusionsFingerprint);
  mocks.memory.mockResolvedValue({ value: { excludedMediaIds: ["prior-bed1", "another-unselected"] } });
  expect((await getHistoricalAssignmentExamples(input)).exclusionsFingerprint).not.toBe(excluded.exclusionsFingerprint);
});
it("corrupt exclusion state fails closed and zero budget does not query submissions", async () => {
  mocks.memory.mockResolvedValue({ value: { excludedMediaIds: "invalid" } });
  await expect(getHistoricalAssignmentExamples(input)).rejects.toThrow(); expect(mocks.submissions).not.toHaveBeenCalled();
  mocks.memory.mockResolvedValue(null);
  expect((await getHistoricalAssignmentExamples({ ...input, maxImages: 0 })).examples).toEqual([]); expect(mocks.submissions).not.toHaveBeenCalled();
});
it("training samples more than two jobs per class and binds current labels and exclusions to revision", async () => {
  mocks.latest.mockResolvedValue(submission("new"));
  mocks.submissions.mockResolvedValue(Array.from({ length: 25 }, (_, index) => submission(`job-${index}`)));
  const result = await readPropertyTrainingExamples("property");
  expect(result.labels).toEqual(fields); expect(result.examples).toHaveLength(40);
  expect(new Set(result.examples.filter(row => row.fieldId === "bed1").map(row => row.sourceJobId)).size).toBe(20);
  expect((await readPropertyTrainingExamples("property")).revision).toBe(result.revision);
  mocks.memory.mockResolvedValue({ value: { excludedMediaIds: ["outside-sample"] } });
  expect((await readPropertyTrainingExamples("property")).revision).not.toBe(result.revision);
});
