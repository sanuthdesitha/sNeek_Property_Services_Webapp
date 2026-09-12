import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cleaner/jobs/[id]/laundry-status/route";
const m = vi.hoisted(() => ({ session: vi.fn(), assignment: vi.fn(), job: vi.fn(), property: vi.fn(), time: vi.fn(), draft: vi.fn(), update: vi.fn(), query: vi.fn(), lock: vi.fn(), revision: vi.fn(), effective: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/cleaner/draft-identity", () => ({ cleanerDraftIdentity: () => "identity" }));
vi.mock("@/lib/cleaner/shared-job-draft", () => ({ withSharedCleanerJobDraftLock: m.lock, getSharedCleanerJobDraft: m.draft }));
vi.mock("@/lib/laundry/cleaner-status", () => ({ applyCleanerLaundryStatusUpdate: m.update }));
vi.mock("@/lib/settings", () => ({ getTransactionAppSettings: async () => ({ noPhotoExemptCleanerIds: [] }) }));
vi.mock("@/lib/forms/resolve-effective-job-form", () => ({ resolveEffectiveJobForm: m.effective }));
vi.mock("@/lib/forms/job-form-revision", () => ({ jobFormRevision: m.revision }));
vi.mock("@/lib/job-tasks/service", () => ({ listCleanerJobTasks: async () => [] }));
vi.mock("@/lib/jobs/meta", () => ({ parseJobInternalNotes: () => ({}) }));
vi.mock("@/lib/forms/final-checkup", () => ({ guestSummaryFromReservation: () => ({}), resolveFinalCheckupItems: () => [] }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: () => "https://example.invalid/laundry" }));
const revision = "a".repeat(64);
const tx = { $queryRaw: m.query, jobAssignment: { findFirst: m.assignment }, job: { findUnique: m.job }, property: { findUnique: m.property }, timeLog: { findFirst: m.time } };
const request = (patch = {}, identity: string | null = "identity") => new NextRequest("http://localhost/api/cleaner/jobs/job/laundry-status", { method: "POST", headers: { "Content-Type": "application/json", ...(identity ? { "X-Cleaner-Draft-Identity": identity } : {}) }, body: JSON.stringify({ laundryOutcome: "READY_FOR_PICKUP", bagLocation: "Gate", laundryPhotoKey: "key", formRevision: revision, ...patch }) });
const context = { params: { id: "job" } };
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "cleaner", role: "CLEANER" } });
  m.assignment.mockResolvedValue({ id: "assigned" }); m.time.mockResolvedValue({ id: "time" });
  m.job.mockResolvedValue({ id: "job", propertyId: "property", status: "IN_PROGRESS", jobType: "AIRBNB_TURNOVER", isRework: false, property: { laundryEnabled: true } });
  m.property.mockResolvedValue({ laundryEnabled: true });
  m.lock.mockImplementation(async (_: string, run: (tx: unknown) => unknown) => run(tx));
  m.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "key", fieldId: "laundry", destination: { type: "laundry" }, formRevision: revision } } });
  m.revision.mockReturnValue(revision); m.effective.mockResolvedValue({ template: { id: "template" }, submittable: true });
  m.update.mockResolvedValue({ duplicated: false, laundryTask: { status: "CONFIRMED" } });
});
describe("early laundry evidence authorization", () => {
  it("checks and writes inside the same transaction, with notification work after commit", async () => {
    let inside = false; const notify = vi.fn(() => { expect(inside).toBe(false); return Promise.resolve(); });
    m.lock.mockImplementation(async (_: string, run: (tx: unknown) => unknown) => { inside = true; const result = await run(tx); inside = false; return result; });
    m.update.mockImplementation(async (_: unknown, execution: any) => { expect(inside).toBe(true); expect(execution.transaction).toBe(tx); execution.afterCommit.push(notify); return { duplicated: false }; });
    expect((await POST(request(), context)).status).toBe(200);
    expect(m.draft).toHaveBeenCalledWith("job", tx); expect(notify).toHaveBeenCalledOnce();
    expect(m.query.mock.calls.map(([parts]) => parts.join(" ")).join(" ")).toContain('FOR UPDATE');
  });
  it.each([null, "other"])("refuses missing or wrong durable capture identity %s", async identity => {
    expect((await POST(request({}, identity), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects a stale current form even if the supplied revision matches its old receipt", async () => {
    m.revision.mockReturnValue("b".repeat(64));
    expect((await POST(request(), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled();
  });
  it("rechecks assignment, job status and property eligibility before using evidence", async () => {
    m.assignment.mockResolvedValue(null); expect((await POST(request(), context)).status).toBe(403);
    m.assignment.mockResolvedValue({ id: "assigned" }); m.property.mockResolvedValue({ laundryEnabled: false }); expect((await POST(request(), context)).status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("preserves calls without an identity header when no receipt ledger exists", async () => {
    m.draft.mockResolvedValue(null);
    expect((await POST(request({ formRevision: undefined }, null), context)).status).toBe(200);
  });
  it("rejects detached keys and active laundry photos omitted by a changed outcome", async () => {
    expect((await POST(request({ laundryOutcome: "NOT_READY", laundrySkipReasonCode: "OTHER", laundryPhotoKey: undefined }), context)).status).toBe(409);
    m.draft.mockResolvedValue({ evidenceReceipts: { capture: { key: "key", fieldId: "laundry", destination: { type: "laundry" }, formRevision: revision, detached: true } } });
    expect((await POST(request(), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled();
  });
});
