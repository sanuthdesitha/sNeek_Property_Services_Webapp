// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ role: vi.fn(), job: vi.fn(), read: vi.fn(), save: vi.fn(), lock: vi.fn(), audit: vi.fn(), history: vi.fn(), revisions: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-review-contract", () => ({ currentEvidenceRevisions: mocks.revisions }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: mocks.job }, auditLog: { findMany: mocks.history } } }));
vi.mock("@/lib/cleaner/shared-job-draft", () => ({ getSharedCleanerJobDraft: mocks.read, saveSharedCleanerJobDraft: mocks.save, withSharedCleanerJobDraftLock: mocks.lock }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `/safe/${key}` }));
import { GET, POST } from "@/app/api/admin/jobs/[id]/evidence-review/route";
import { evidenceEntryVersion } from "@/lib/cleaner/evidence-review-service";
let draft: any, role: string, tx: any;
const key = "forms/source-job/capture/original-cleaner/photo.jpg";
const context = { params: { id: "job" } };
const req = (body?: unknown) => new NextRequest("http://localhost/api/admin/jobs/job/evidence-review", body ? { method: "POST", body: JSON.stringify(body) } : undefined);
const input = () => ({ action: "DISCARD_DRAFT_REFERENCE", key, version: evidenceEntryVersion(draft, key), reason: "Reference belongs to a different historical job" });
beforeEach(() => {
  vi.resetAllMocks(); role = "ADMIN"; mocks.revisions.mockResolvedValue({ "original-cleaner": "current-revision" });
  draft = { updatedAt: "2020-01-01", updatedByUserId: "original-cleaner", updatedByName: "Original", editorSessionId: "old", state: { bulkPool: [{ key, kind: "image", name: "Old photo", url: "javascript:untrusted" }] }, evidenceReceipts: { capture: { key, fieldId: "bulkPool", destination: { type: "bulkPool" }, draftIdentity: "old-identity", formRevision: "old-revision", version: 2 } } };
  mocks.role.mockImplementation(async (allowed: string[]) => { if (!allowed.includes(role)) throw new Error("FORBIDDEN"); return { user: { id: "office-user", name: "Office", role } }; });
  mocks.job.mockResolvedValue({ id: "job", status: "IN_PROGRESS" }); mocks.read.mockImplementation(async () => draft);
  mocks.save.mockImplementation(async (_id, value) => { draft = value; }); mocks.audit.mockResolvedValue({ id: "audit" }); mocks.history.mockResolvedValue([]);
  tx = { job: { findUnique: mocks.job }, $queryRaw: vi.fn(), auditLog: { create: mocks.audit } };
  mocks.lock.mockImplementation(async (_id, fn) => { const before = structuredClone(draft); try { return await fn(tx); } catch (err) { draft = before; throw err; } });
});
it("exposes mismatches and safe original previews with private caching", async () => {
  const response = await GET(req(), context); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json(); expect(body.rows[0].issues).toContain("Stored under another job"); expect(body.rows[0].issues).toContain("Captured under an older or different form version");
  expect(body.rows[0].previewUrl).toBe(`/safe/${key}`); expect(body.rows[0].receipts[0]).toMatchObject({ draftIdentity: "old-identity", formRevision: "old-revision" });
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["ADMIN", "OPS_MANAGER"])("allows %s to discard only the current draft reference with an atomic audit", async actorRole => {
  role = actorRole; const before = structuredClone(draft); const body = input();
  expect((await POST(req(body), context)).status).toBe(200);
  expect(draft.state.bulkPool).toEqual([]); expect(draft.evidenceReceipts.capture).toMatchObject({ ...before.evidenceReceipts.capture, detached: true });
  expect(mocks.save.mock.calls[0][0]).toBe("job"); expect(mocks.save.mock.calls[0][2]).toBe(tx);
  expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "office-user", jobId: "job", action: "OFFICE_DISCARD_DRAFT_REFERENCE", before: expect.objectContaining({ key }), after: expect.objectContaining({ key, reason: body.reason, originalRetained: true, submittedRecordsUnchanged: true }) }) });
  expect((await POST(req(body), context)).status).toBe(200); expect(mocks.audit).toHaveBeenCalledTimes(1);
});
it.each(["CLEANER", "QA_INSPECTOR", "CLIENT", "LAUNDRY", "MAINTENANCE", "VA"])("denies %s read and override", async value => {
  role = value; expect((await GET(req(), context)).status).toBe(403); expect((await POST(req(input()), context)).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"])("keeps %s jobs read-only", async status => {
  mocks.job.mockResolvedValue({ id: "job", status }); expect((await (await GET(req(), context)).json()).locked).toBe(true);
  expect((await POST(req(input()), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it("rejects stale review snapshots instead of overriding newly changed evidence", async () => {
  const body = input(); draft.evidenceReceipts.capture.version++;
  expect((await POST(req(body), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
});
it("requires a reason and does not provide an adoption or approval operation", async () => {
  expect((await POST(req({ ...input(), reason: "" }), context)).status).toBe(400);
  expect((await POST(req({ ...input(), action: "ADOPT_EVIDENCE" }), context)).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
});
it("does not report success or retain changes when the audit write fails", async () => {
  const before = structuredClone(draft); mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
  expect((await POST(req(input()), context)).status).toBe(500); expect(draft).toEqual(before);
});
it("fails closed when a saved reference disappeared", async () => {
  const body = input(); draft.state.bulkPool = []; draft.evidenceReceipts = {};
  expect((await POST(req(body), context)).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
});
