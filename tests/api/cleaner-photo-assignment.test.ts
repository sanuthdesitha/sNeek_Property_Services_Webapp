// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ role: vi.fn(), assignment: vi.fn(), job: vi.fn(), lock: vi.fn(), draft: vi.fn(), form: vi.fn(), revision: vi.fn(), tasks: vi.fn(), settings: vi.fn(), visionSettings: vi.fn(), image: vi.fn(), assign: vi.fn(), history: vi.fn(), model: vi.fn(), predict: vi.fn(), aiConfig: vi.fn() }));
vi.mock("@/lib/ai/historical-assignment-examples", () => ({ getHistoricalAssignmentExamples: m.history }));
vi.mock("@/lib/ai/property-photo-model", () => ({ predictPropertyRecognition: m.predict }));
vi.mock("@/lib/ai/config", () => ({ getVisionProviderConfiguration: m.aiConfig }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/cleaner/shared-job-draft", () => ({ withSharedCleanerJobDraftLock: m.lock, getSharedCleanerJobDraft: m.draft }));
vi.mock("@/lib/forms/resolve-effective-job-form", () => ({ resolveEffectiveJobForm: m.form }));
vi.mock("@/lib/forms/job-form-revision", () => ({ jobFormRevision: m.revision }));
vi.mock("@/lib/settings", () => ({ getTransactionAppSettings: m.settings }));
vi.mock("@/lib/job-tasks/service", () => ({ listCleanerJobTasks: m.tasks }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: m.visionSettings }));
vi.mock("@/lib/ai/images", () => ({ loadVisionImage: m.image }));
vi.mock("@/lib/ai/vision", () => ({ assignPhotosToFields: m.assign }));
import { POST } from "@/app/api/cleaner/jobs/[id]/evidence/auto-assign/route";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
const session = { user: { id: "cleaner", role: "CLEANER" } };
const identity = cleanerDraftIdentity(session, "job"); const revision = "a".repeat(64);
const captureId = "12345678-1234-4123-8123-123456789012"; const key = `forms/job/${captureId}/cleaner/photo.jpg`;
const input = { templateId: "template", formRevision: revision, photos: [{ captureId, key, version: 0 }] };
const request = (patch: any = {}, header = identity) => new NextRequest("http://localhost/api/cleaner/jobs/job/evidence/auto-assign", { method: "POST", headers: { "X-Cleaner-Draft-Identity": header }, body: JSON.stringify({ ...input, ...patch }) });
const run = (patch: any = {}, header = identity) => POST(request(patch, header), { params: { id: "job" } });
let draft: any; let fields: any[];
beforeEach(() => {
  vi.resetAllMocks(); m.aiConfig.mockReturnValue({ configured: true }); m.model.mockResolvedValue(null); m.predict.mockResolvedValue(null); m.history.mockResolvedValue({ examples: [], exclusionsFingerprint: "none" }); fields = [{ id: "bathroom", type: "photo", label: "Bathroom after", references: [{ kind: "image", storageKey: "form-references/admin/bathroom.jpg" }, { kind: "image", url: "http://169.254.169.254/secret" }] }];
  draft = { state: { bulkPool: [{ key, kind: "image" }], answers: {} }, evidenceReceipts: { [captureId]: { key, fieldId: "bulk", destination: { type: "bulkPool" }, version: 0, formRevision: revision, draftIdentity: identity } } };
  m.role.mockResolvedValue(session); m.assignment.mockResolvedValue({ id: "assignment" }); m.job.mockResolvedValue({ id: "job", propertyId: "property", status: "IN_PROGRESS", jobType: "REGULAR_CLEAN", property: {} });
  m.lock.mockImplementation((_id, callback) => callback({ $queryRaw: vi.fn(), aiPropertyModelTraining: { findUnique: m.model }, jobAssignment: { findFirst: m.assignment }, job: { findUnique: m.job } }));
  m.draft.mockImplementation(async () => draft); m.form.mockImplementation(async () => ({ submittable: true, template: { id: "template", schema: { sections: [{ id: "room", title: "Room", fields }] } } }));
  m.revision.mockReturnValue(revision); m.tasks.mockResolvedValue([]); m.settings.mockResolvedValue({ noPhotoExemptCleanerIds: [], finalCheckup: {} });
  m.visionSettings.mockResolvedValue({ assignmentEnabled: true, batchSize: 4, minConfidence: 0.85 });
  m.image.mockImplementation(async (_key, id) => ({ id, data: "eA==", mediaType: "image/jpeg" }));
  m.assign.mockResolvedValue({ assignments: [{ photoId: captureId, fieldId: "bathroom", confidence: 0.95, reason: "Bathroom fixtures match the reference." }] });
});
it("returns proposals from canonical fields and owned bytes without moving evidence", async () => {
  const before = JSON.stringify(draft); const response = await run(); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ draftIdentity: identity, minConfidence: 0.85, proposals: [{ captureId, key, version: 0, fieldId: "bathroom", confidence: 0.95 }] });
  expect(m.image.mock.calls.map(call => call[0])).toEqual([key, "form-references/admin/bathroom.jpg"]);
  expect(m.assign.mock.calls[0][0].fields).toMatchObject([{ id: "bathroom", sectionLabel: "Room", referenceImages: [{ data: "eA==" }] }]); expect(JSON.stringify(draft)).toBe(before);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it.each([key.replace("forms/job/", "forms/other/"), key.replace("/cleaner/", "/another/"), "https://example.com/photo.jpg"])("rejects cross-job/actor/url input before storage/provider: %s", async value => {
  expect((await run({ photos: [{ ...input.photos[0], key: value }] })).status).toBe(403); expect(m.image).not.toHaveBeenCalled(); expect(m.assign).not.toHaveBeenCalled();
});
it("requires current cleaner identity and assignment", async () => {
  expect((await run({}, "wrong")).status).toBe(409); m.assignment.mockResolvedValue(null); expect((await run()).status).toBe(403); expect(m.assign).not.toHaveBeenCalled();
});
it.each(["missing", "detached", "moved", "version", "unknownPool"])("rejects unavailable acknowledged evidence: %s", async kind => {
  if (kind === "missing") draft.evidenceReceipts = {};
  if (kind === "detached") draft.evidenceReceipts[captureId].detached = true;
  if (kind === "moved") draft.evidenceReceipts[captureId].destination = { type: "formField", fieldId: "bathroom" };
  if (kind === "version") draft.evidenceReceipts[captureId].version = 1;
  if (kind === "unknownPool") draft.state.bulkPool = [];
  expect((await run()).status).toBe(409); expect(m.image).not.toHaveBeenCalled();
});
it("blocks finished jobs, changed forms and disabled configuration", async () => {
  m.job.mockResolvedValueOnce({ id: "job", status: "COMPLETED" }); expect((await run()).status).toBe(409);
  m.revision.mockReturnValueOnce("b".repeat(64)); expect((await run()).status).toBe(409);
  m.visionSettings.mockResolvedValue({ assignmentEnabled: false }); expect((await run()).status).toBe(409); expect(m.assign).not.toHaveBeenCalled();
});
it("keeps uncertain matches unassigned and excludes invisible/full fields", async () => {
  fields.push({ id: "hidden", type: "photo", conditional: { fieldId: "show", value: true } }, { id: "full", type: "photo", maxFiles: 1 }); draft.state.uploads = { full: [{ key: "existing" }] };
  m.assign.mockResolvedValue({ assignments: [{ photoId: captureId, fieldId: "bathroom", confidence: 0.4, reason: "Unclear room" }] });
  const response = await run(); expect(response.status).toBe(200); expect((await response.json()).proposals[0].fieldId).toBeNull(); expect(m.assign.mock.calls[0][0].fields.map((field: any) => field.id)).toEqual(["bathroom"]);
});
it.each([{ assignments: [] }, { assignments: [{ photoId: captureId, fieldId: "other-job-field", confidence: 1, reason: "match" }] }, { assignments: [{ photoId: "unknown", fieldId: "bathroom", confidence: 1, reason: "match" }] }, { assignments: [{ photoId: captureId, fieldId: "bathroom", confidence: "high", reason: "match" }] }])("rejects malformed or foreign provider output %#", async result => {
  m.assign.mockResolvedValue(result); expect((await run()).status).toBe(502);
});
it("discards responses after evidence changes while the provider is running", async () => {
  m.assign.mockImplementation(async () => { draft.evidenceReceipts[captureId].version = 1; return { assignments: [] }; }); expect((await run()).status).toBe(409);
});
it("rejects caller field labels/urls and duplicate keys; errors never expose provider details", async () => {
  expect((await run({ fields: [{ id: "fake" }] })).status).toBe(400);
  expect((await run({ photos: [input.photos[0], input.photos[0]] })).status).toBe(400);
  m.assign.mockRejectedValue(new Error("secret-provider-key")); const response = await run(); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("secret-provider-key");
});

it("uses same-property historical photos separately from cleanliness references", async () => {
  m.history.mockResolvedValue({ examples: [{ fieldId: "bathroom", mediaId: "old-photo", storageKey: "forms/old-job/capture/cleaner/photo.jpg", sourceJobId: "old-job", sourceSubmissionId: "old-submission", submittedAt: new Date("2026-01-01") }], exclusionsFingerprint: "none" });
  expect((await run()).status).toBe(200); expect(m.history.mock.calls[0][0]).toMatchObject({ propertyId: "property", currentJobId: "job" });
  const field = m.assign.mock.calls[0][0].fields[0]; expect(field.referenceImages).toHaveLength(1); expect(field.historicalExamples).toHaveLength(1); expect(m.image.mock.calls.map(call => call[0])).toContain("forms/old-job/capture/cleaner/photo.jpg");
});
it("rejects changing or excluded historical examples before provider disclosure", async () => {
  m.history.mockResolvedValueOnce({ examples: [{ fieldId: "bathroom", mediaId: "old", storageKey: "forms/old/photo" }], exclusionsFingerprint: "none" }).mockResolvedValue({ examples: [], exclusionsFingerprint: "excluded" });
  expect((await run()).status).toBe(409); expect(m.assign).not.toHaveBeenCalled();
});
it("keeps history opt-out and disables changed memory configuration without automatic retries", async () => {
  m.visionSettings.mockResolvedValue({ assignmentEnabled: true, batchSize: 4, minConfidence: .85, historicalAssignmentExamplesEnabled: false }); expect((await run()).status).toBe(200); expect(m.history).not.toHaveBeenCalled();
  m.assign.mockClear(); m.visionSettings.mockResolvedValueOnce({ assignmentEnabled: true, batchSize: 4, minConfidence: .85, historicalAssignmentExamplesEnabled: true }).mockResolvedValue({ assignmentEnabled: true, batchSize: 4, minConfidence: .85, historicalAssignmentExamplesEnabled: false }); expect((await run()).status).toBe(409); expect(m.assign).not.toHaveBeenCalled();
});
it("spreads the twenty-image budget across fields and both reference types", async () => {
  fields = Array.from({ length: 10 }, (_, index) => ({ id: index ? `room${index}` : "bathroom", type: "photo", label: `Room ${index}`, references: [0,1].map(n => ({ kind: "image", storageKey: `form-references/admin/room${index}-${n}.jpg` })) }));
  m.history.mockResolvedValue({ examples: fields.map(field => ({ fieldId: field.id, mediaId: `old-${field.id}`, storageKey: `forms/old/${field.id}.jpg` })), exclusionsFingerprint: "none" });
  expect((await run()).status).toBe(200); expect(m.image).toHaveBeenCalledTimes(20); const sent = m.assign.mock.calls[0][0].fields;
  expect(sent.every((field: any) => field.referenceImages.length + field.historicalExamples.length >= 1)).toBe(true);
  expect(sent.reduce((n: number, field: any) => n + field.historicalExamples.length, 0)).toBeGreaterThan(0);
  expect(sent.reduce((n: number, field: any) => n + field.referenceImages.length, 0)).toBeGreaterThan(0);
});
it("invalidates historical exclusion edits even when chosen examples are unchanged", async () => {
  m.history.mockResolvedValueOnce({ examples: [], exclusionsFingerprint: "before" }).mockResolvedValue({ examples: [], exclusionsFingerprint: "after" });
  expect((await run()).status).toBe(409); expect(m.assign).not.toHaveBeenCalled();
});

it("uses a current validated property model without a vision request", async () => {
 m.visionSettings.mockResolvedValue({ assignmentEnabled: true, dedicatedRecognitionEnabled: true, batchSize: 4, minConfidence: .85 }); m.model.mockResolvedValue({ status: "READY", desiredRevision: "revision", trainedRevision: "revision", modelVersion: "model1" });
 m.predict.mockResolvedValue({ trained: true, modelVersion: "model1", assignments: [{ photoId: captureId, fieldId: "bathroom", confidence: .95, reason: "Validated property model" }] });
 expect((await run()).status).toBe(200); expect(m.assign).not.toHaveBeenCalled(); expect(m.predict.mock.calls[0][0]).toMatchObject({ propertyId: "property", revision: "revision", modelVersion: "model1" });
});
it.each(["PENDING", "REJECTED", "NEEDS_DATA"])("falls back for %s model without predicting", async status => {
 m.visionSettings.mockResolvedValue({ assignmentEnabled: true, dedicatedRecognitionEnabled: true, batchSize: 4, minConfidence: .85 }); m.model.mockResolvedValue({ status, desiredRevision: "new", trainedRevision: "old", modelVersion: "model1" }); expect((await run()).status).toBe(200); expect(m.predict).not.toHaveBeenCalled(); expect(m.assign).toHaveBeenCalledTimes(1);
});
it("falls back for uncertain model predictions and rejects mid-request model replacement", async () => {
 m.visionSettings.mockResolvedValue({ assignmentEnabled: true, dedicatedRecognitionEnabled: true, batchSize: 4, minConfidence: .85 }); const model = { status: "READY", desiredRevision: "revision", trainedRevision: "revision", modelVersion: "model1" }; m.model.mockResolvedValue(model);
 m.predict.mockResolvedValue({ trained: true, modelVersion: "model1", assignments: [{ photoId: captureId, fieldId: "bathroom", confidence: .4, reason: "Uncertain" }] }); expect((await run()).status).toBe(200); expect(m.assign).toHaveBeenCalledTimes(1);
 m.model.mockResolvedValueOnce(model).mockResolvedValueOnce(model).mockResolvedValue({ ...model, modelVersion: "newmodel" }); expect((await run()).status).toBe(409);
});

it("returns explicit manual choices when no trained model or vision fallback is configured", async () => { m.aiConfig.mockReturnValue({ configured: false }); const response = await run(); expect(response.status).toBe(200); expect((await response.json()).proposals[0]).toMatchObject({ fieldId: null, confidence: 0 }); expect(m.assign).not.toHaveBeenCalled(); });
