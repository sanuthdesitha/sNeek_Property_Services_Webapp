// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ role: vi.fn(), assignment: vi.fn(), job: vi.fn(), lock: vi.fn(),
  read: vi.fn(), save: vi.fn(), form: vi.fn(), revision: vi.fn(), tasks: vi.fn(), settings: vi.fn(), head: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { jobAssignment: { findFirst: mocks.assignment } } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/cleaner/shared-job-draft", () => ({ withSharedCleanerJobDraftLock: mocks.lock, getSharedCleanerJobDraft: mocks.read, saveSharedCleanerJobDraft: mocks.save }));
vi.mock("@/lib/forms/resolve-effective-job-form", () => ({ resolveEffectiveJobForm: mocks.form }));
vi.mock("@/lib/forms/job-form-revision", () => ({ jobFormRevision: mocks.revision }));
vi.mock("@/lib/settings", () => ({ getTransactionAppSettings: mocks.settings }));
vi.mock("@/lib/job-tasks/service", () => ({ listCleanerJobTasks: mocks.tasks }));
vi.mock("@/lib/s3", () => ({ resolveS3: async () => ({ client: { headObject: () => ({ promise: mocks.head }) }, bucket: "fixture" }), publicUrl: (key: string) => `https://safe.invalid/${key}` }));
import { POST, DELETE } from "@/app/api/cleaner/jobs/[id]/evidence/route";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
const session = { user: { id: "cleaner", role: "CLEANER", name: "Cleaner" } };
const identity = cleanerDraftIdentity(session, "job");
const captureId = "12345678-1234-4123-8123-123456789012";
const key = `forms/job/${captureId}/cleaner/file.jpg`;
const revision = "a".repeat(64);
const body = { captureId, key, fieldId: "photo", templateId: "template", formRevision: revision, name: "file.jpg" };
const context = { params: { id: "job" } };
function request(patch: Record<string, unknown> = {}, actor = identity, method = "POST") {
  return new NextRequest("http://localhost/api/cleaner/jobs/job/evidence", { method,
    headers: { "X-Cleaner-Draft-Identity": actor }, body: JSON.stringify({ ...body, ...patch }) });
}
let draft: any; let tx: any; let events: string[];
beforeEach(() => {
  vi.resetAllMocks(); draft = null; events = [];
  tx = { jobAssignment: { findFirst: mocks.assignment }, job: { findUnique: mocks.job }, $queryRaw: mocks.query };
  mocks.role.mockResolvedValue(session); mocks.assignment.mockResolvedValue({ id: "assignment" });
  mocks.job.mockResolvedValue({ id: "job", propertyId: "property", jobType: "DEEP_CLEAN", isRework: false, status: "IN_PROGRESS", property: {} });
  mocks.lock.mockImplementation(async (_job, callback) => { events.push("lock"); return callback(tx); });
  mocks.query.mockResolvedValue([]); mocks.read.mockImplementation(async () => draft);
  mocks.save.mockImplementation(async (_job, value) => { draft = value; events.push("save"); });
  mocks.form.mockResolvedValue({ submittable: true, template: { id: "template", schema: { sections: [{ id: "room", fields: [{ id: "photo", type: "photo", maxFiles: 2 }] }] } } });
  mocks.revision.mockReturnValue(revision); mocks.tasks.mockResolvedValue([]);
  mocks.settings.mockResolvedValue({ noPhotoExemptCleanerIds: [], finalCheckup: { enabled: false } });
  mocks.head.mockImplementation(async () => { events.push("head"); return { ContentLength: 123, ContentType: "image/jpeg" }; });
});
describe("evidence attachment acknowledgement", () => {
  it("keeps no-allocation tombstones idempotent after a late owned allocation", async () => {
    expect((await DELETE(request({ cancelPending: true, key: undefined }, identity, "DELETE"), context)).status).toBe(200);
    expect((await DELETE(request({ cancelPending: true }, identity, "DELETE"), context)).status).toBe(200);
    expect((await POST(request(), context)).status).toBe(409);
    expect((await DELETE(request({ cancelPending: true, key: `forms/job/${captureId}/other/file.jpg` }, identity, "DELETE"), context)).status).toBe(409);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("cancels pending capture with allocation=%s and rejects delayed attachment", async allocated => {
    const response = await DELETE(request({ cancelPending: true, key: allocated ? key : undefined }, identity, "DELETE"), context);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ captureId, detached: true });
    expect(draft.evidenceReceipts[captureId].detached).toBe(true);
    expect(mocks.head).not.toHaveBeenCalled();
    expect((await POST(request(), context)).status).toBe(409);
    expect((await DELETE(request({ cancelPending: true, key: allocated ? key : undefined }, identity, "DELETE"), context)).status).toBe(200);
  });
  it.each(["revision", "assignment", "key", "identity"])("refuses pending cancellation with changed %s", async change => {
    if (change === "revision") mocks.revision.mockReturnValue("b".repeat(64));
    if (change === "assignment") mocks.assignment.mockResolvedValue(null);
    const response = await DELETE(request({ cancelPending: true, key: change === "key" ? `forms/job/${captureId}/another/file.jpg` : key }, change === "identity" ? "other" : identity, "DELETE"), context);
    expect(response.status).toBe(change === "assignment" || change === "key" ? 403 : 409); expect(mocks.save).not.toHaveBeenCalled();
  });
  const legacyKeys = ["forms/cleaner/old.jpg", "jobs/job/cleaner/old.jpg"];
  function legacyPool(oldKey: string) {
    draft = { state: { bulkPool: [{ key: oldKey, kind: "image", url: "https://old.invalid/photo", name: "old.jpg" }] }, evidenceReceipts: {} };
    return { legacy: true, key: oldKey, destination: { type: "bulkPool" }, fieldId: "bulkPool" };
  }
  it.each(legacyKeys)("adopts %s once, moves and detaches without reuploading", async oldKey => {
    const adoption = legacyPool(oldKey);
    expect((await POST(request(adoption), context)).status).toBe(200);
    expect(draft.evidenceReceipts[captureId]).toMatchObject({ key: oldKey, draftIdentity: identity, formRevision: revision, version: 0, destination: { type: "bulkPool" } });
    expect(draft.state.bulkPool).toEqual([{ key: oldKey, kind: "image", url: `https://safe.invalid/${oldKey}`, name: "file.jpg" }]);
    expect((await POST(request(adoption), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const move = { ...adoption, fieldId: "photo", destination: { type: "formField", fieldId: "photo" }, move: { from: { type: "bulkPool" }, version: 0 } };
    expect((await POST(request(move), context)).status).toBe(200);
    expect(draft.state.bulkPool).toEqual([]); expect(draft.state.uploads.photo[0].key).toBe(oldKey);
    expect((await POST(request(move), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect((await DELETE(request({ key: oldKey }, identity, "DELETE"), context)).status).toBe(200);
    expect(draft.evidenceReceipts[captureId].detached).toBe(true);
    expect((await POST(request(adoption), context)).status).toBe(409);
  });
  it.each(["forms/other/old.jpg", "jobs/other/cleaner/old.jpg", "jobs/job/other/old.jpg", "forms/cleaner/../old.jpg", "forms/cleaner/..", "forms/cleaner/old\\file.jpg", "forms/cleaner/old\nfile.jpg", "forms/cleaner/", `forms/job/${captureId}/cleaner/file.jpg`])("rejects invalid legacy ownership %s before storage", async oldKey => {
    expect((await POST(request(legacyPool(oldKey)), context)).status).toBe(403);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["missing", "nonimage", "different-key", "target"])("rejects legacy adoption with %s pool context", async mode => {
    const adoption = legacyPool(legacyKeys[0]);
    if (mode === "missing") draft.state.bulkPool = [];
    if (mode === "nonimage") draft.state.bulkPool[0].kind = "video";
    if (mode === "different-key") draft.state.bulkPool[0].key = "forms/cleaner/other.jpg";
    expect((await POST(request(mode === "target" ? { ...adoption, destination: { type: "formField", fieldId: "photo" } } : adoption), context)).status).toBe(409);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["field", "task", "laundry", "carry"])("rejects legacy photo also attached to %s", async location => {
    const adoption = legacyPool(legacyKeys[0]); const media = draft.state.bulkPool[0];
    if (location === "field") draft.state.uploads = { photo: [media] };
    if (location === "task") draft.state.taskDrafts = { task: { proof: [media] } };
    if (location === "laundry") draft.state.laundry = { photo: [media] };
    if (location === "carry") draft.state.carryForward = { photos: [media] };
    expect((await POST(request(adoption), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([false, true])("rejects a conflicting legacy receipt including detached=%s", async detached => {
    const adoption = legacyPool(legacyKeys[0]);
    draft.evidenceReceipts.other = { key: adoption.key, detached, draftIdentity: "other", formRevision: revision, fieldId: "bulkPool", destination: { type: "bulkPool" } };
    expect((await POST(request(adoption), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["stale", "unauthorized", "removed", "content"])("preserves legacy guards for %s", async change => {
    const adoption = legacyPool(legacyKeys[0]);
    if (change === "stale") mocks.revision.mockReturnValue("b".repeat(64));
    if (change === "unauthorized") mocks.role.mockRejectedValue(new Error("UNAUTHORIZED"));
    if (change === "removed") mocks.assignment.mockResolvedValueOnce({ id: "assignment" }).mockResolvedValueOnce(null);
    if (change === "content") mocks.head.mockResolvedValue({ ContentLength: 123, ContentType: "video/mp4" });
    expect((await POST(request(adoption), context)).status).toBe(change === "unauthorized" ? 401 : change === "removed" ? 403 : 409);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["bulkPool", "jobTask", "laundry", "carryForwardNew"])("attaches and detaches typed %s evidence without pretending it is a form field", async type => {
    mocks.job.mockResolvedValue({ id: "job", propertyId: "property", jobType: "AIRBNB_TURNOVER", status: "IN_PROGRESS", property: {} });
    mocks.tasks.mockResolvedValue([{ id: "task", source: "OTHER" }]);
    const destination = type === "jobTask" ? { type, taskId: "task" } : { type };
    expect((await POST(request({ destination }), context)).status).toBe(200);
    expect(draft.evidenceReceipts[captureId].destination).toEqual(destination);
    expect(draft.state.uploads?.photo).toBeUndefined();
    expect((await DELETE(request({}, identity, "DELETE"), context)).status).toBe(200);
    expect(draft.evidenceReceipts[captureId].detached).toBe(true);
  });
  it("rejects nonexistent task and ineligible laundry destinations", async () => {
    expect((await POST(request({ destination: { type: "jobTask", taskId: "other" } }), context)).status).toBe(409);
    expect((await POST(request({ destination: { type: "laundry" } }), context)).status).toBe(409);
  });
  it("acknowledges bulk moves once and rejects old destinations and stale move versions", async () => {
    const pool = { type: "bulkPool" }; const field = { type: "formField", fieldId: "photo" };
    expect((await POST(request({ destination: pool }), context)).status).toBe(200);
    const move = { destination: field, move: { from: pool, version: 0 } };
    expect((await POST(request(move), context)).status).toBe(200);
    expect(draft.state.bulkPool).toEqual([]); expect(draft.state.uploads.photo).toHaveLength(1);
    expect((await POST(request(move), context)).status).toBe(200); expect(mocks.save).toHaveBeenCalledTimes(2);
    expect((await POST(request({ destination: pool }), context)).status).toBe(409);
    expect((await POST(request({ destination: pool, move: { from: field, version: 0 } }), context)).status).toBe(409);
    expect((await POST(request({ destination: pool, move: { from: field, version: 1 } }), context)).status).toBe(200);
    expect(draft.state.uploads.photo).toEqual([]); expect(draft.state.bulkPool).toHaveLength(1);
  });
  it("rejects a hidden destination and a video sent to a photo-only field", async () => {
    const form = await mocks.form();
    form.template.schema.sections[0].fields[0].conditional = { fieldId: "needed", value: true };
    expect((await POST(request(), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
    delete form.template.schema.sections[0].fields[0].conditional;
    mocks.head.mockResolvedValue({ ContentLength: 123, ContentType: "video/mp4" });
    expect((await POST(request(), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("legacy detach is list-only and database failure is not reported as a bad request", async () => {
    const response = await DELETE(request({}, identity, "DELETE"), context);
    expect(response.status).toBe(200); expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls.map(([sql]) => sql.join("?").match(/FROM "([^"]+)"/)?.[1])).toEqual(["Job", "JobAssignment"]);
    mocks.read.mockRejectedValue(new Error("database unavailable"));
    expect((await DELETE(request({}, identity, "DELETE"), context)).status).toBe(500);
  });
  it("checks storage before locking, uses transactional contract reads, and derives the URL", async () => {
    const response = await POST(request({ url: "https://attacker.invalid" }), context);
    expect(response.status).toBe(200); expect(events).toEqual(["head", "lock", "save"]);
    expect(draft.state.uploads.photo).toEqual([{ key, url: `https://safe.invalid/${key}`, kind: "image", name: "file.jpg" }]);
    expect(await response.json()).toMatchObject({ media: { key, url: `https://safe.invalid/${key}`, kind: "image" } });
    expect(mocks.settings).toHaveBeenCalledWith(tx);
    expect(mocks.form).toHaveBeenCalledWith(expect.anything(), expect.anything(), { database: tx });
    expect(mocks.query.mock.calls.map(([sql]) => sql.join("?").match(/FROM "([^"]+)"/)?.[1])).toEqual(["Job", "JobAssignment", "Property", "AppSetting", "FormTemplate", "JobTask"]);
  });
  it("acknowledges an exact retry once without duplicating media or persistence", async () => {
    await POST(request(), context); const response = await POST(request(), context);
    expect(response.status).toBe(200); expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(draft.state.uploads.photo).toHaveLength(1);
  });
  it.each([`forms/other/${captureId}/cleaner/file.jpg`, `forms/job/${captureId}/other/file.jpg`, "forms/cleaner/file.jpg"])("rejects guessed namespace %s before provider calls", async guessed => {
    expect((await POST(request({ key: guessed }), context)).status).toBe(403);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["assignment", "status", "revision", "field"])("rejects changed %s without persistence", async change => {
    if (change === "assignment") mocks.assignment.mockResolvedValue(null);
    if (change === "status") mocks.job.mockResolvedValue({ status: "SUBMITTED" });
    if (change === "revision") mocks.revision.mockReturnValue("b".repeat(64));
    const response = await POST(request(change === "field" ? { fieldId: "removed" } : {}), context);
    expect(response.status).toBe(change === "assignment" ? 403 : 409);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rechecks assignment after HEAD instead of trusting initial authorization", async () => {
    mocks.assignment.mockResolvedValueOnce({ id: "assignment" }).mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each([[{ code: "NotFound" }, 409], [{ code: "AccessDenied" }, 500]])("keeps provider failure distinct from not-found", async (error, status) => {
    mocks.head.mockRejectedValue(error);
    expect((await POST(request(), context)).status).toBe(status);
    expect(mocks.lock).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("explicit detach keeps the receipt tombstone and blocks a delayed attachment retry", async () => {
    await POST(request(), context);
    expect((await DELETE(request({}, identity, "DELETE"), context)).status).toBe(200);
    expect(draft.state.uploads.photo).toEqual([]); expect(draft.evidenceReceipts[captureId].detached).toBe(true);
    expect((await POST(request(), context)).status).toBe(409);
  });
});
