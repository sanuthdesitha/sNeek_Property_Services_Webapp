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
