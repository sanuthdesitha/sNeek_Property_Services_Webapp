// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cleaner/jobs/[id]/laundry-status/route";
import { getSharedCleanerJobDraft, saveSharedCleanerJobDraft, withSharedCleanerJobDraftLock } from "@/lib/cleaner/shared-job-draft";
import { removeEvidenceKeys } from "@/lib/cleaner/evidence-destination";

const m = vi.hoisted(() => ({ client: null as any, actor: "", deliver: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: m.actor, role: "CLEANER" } }) }));
vi.mock("@/lib/cleaner/draft-identity", () => ({ cleanerDraftIdentity: () => "fixture-identity" }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({ noPhotoExemptCleanerIds: [], laundryOperations: { fastReturnDaysWhenNoNextClean: 2, maxOutdoorDays: 5, fastReturnWhenNoNextClean: true } }) }));
vi.mock("@/lib/forms/resolve-effective-job-form", () => ({ resolveEffectiveJobForm: async () => ({ template: { id: "fixture-template" }, submittable: true }) }));
vi.mock("@/lib/forms/job-form-revision", () => ({ jobFormRevision: () => "a".repeat(64) }));
vi.mock("@/lib/job-tasks/service", () => ({ listCleanerJobTasks: async () => [] }));
vi.mock("@/lib/jobs/meta", () => ({ parseJobInternalNotes: () => ({}) }));
vi.mock("@/lib/forms/final-checkup", () => ({ guestSummaryFromReservation: () => ({}), resolveFinalCheckupItems: () => [] }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://example.invalid/${key}` }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "fixture", html: "fixture" }) }));
vi.mock("@/lib/notification-templates", () => ({ renderNotificationTemplate: () => ({ webSubject: "fixture", webBody: "fixture", smsBody: "fixture" }) }));
vi.mock("@/lib/laundry/teams", () => ({ getAssignedLaundryUsersForProperty: async () => [] }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.deliver }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: () => "https://example.invalid/laundry" }));

const databaseUrl = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const revision = "a".repeat(64);
function request(patch: Record<string, unknown> = {}) { return new NextRequest(`http://localhost/api/cleaner/jobs/${id}/laundry-status`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cleaner-Draft-Identity": "fixture-identity" }, body: JSON.stringify({ laundryOutcome: "READY_FOR_PICKUP", bagLocation: "Fixture gate", laundryPhotoKey: "fixture-key", formRevision: revision, ...patch }) }); }
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; }

describe.skipIf(!databaseUrl)("early laundry handoff with real draft/job locks", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^postgres(ql)?:$/.test(url.protocol) || Array.from(url.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `qa-laundry-evidence-${randomUUID()}`; m.actor = id; m.deliver.mockReset().mockResolvedValue(undefined);
    await m.client.client.create({ data: { id, name: "Laundry verification" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER" } });
    await m.client.property.create({ data: { id, clientId: id, name: "Laundry verification", address: "1 Fixture Street", suburb: "Sydney", laundryEnabled: true } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "AIRBNB_TURNOVER", status: "IN_PROGRESS", scheduledDate: new Date("2026-09-13T00:00:00Z") } });
    await m.client.jobAssignment.create({ data: { jobId: id, userId: id } });
    await m.client.timeLog.create({ data: { jobId: id, userId: id, startedAt: new Date() } });
    await m.client.laundryTask.create({ data: { id, jobId: id, propertyId: id, pickupDate: new Date(), dropoffDate: new Date() } });
    await saveSharedCleanerJobDraft(id, { updatedAt: new Date().toISOString(), updatedByUserId: id, updatedByName: "Fixture", editorSessionId: id,
      evidenceReceipts: { capture: { key: "fixture-key", fieldId: "laundry", destination: { type: "laundry" }, formRevision: revision, draftIdentity: "fixture-identity" } },
      state: { laundry: { photo: [{ key: "fixture-key", url: "https://example.invalid/fixture-key", kind: "image" }] } } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    await m.client.appSetting.deleteMany({ where: { key: `cleaner_job_shared_draft_v1:${id}` } });
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTask: { jobId: id } } });
    await m.client.laundryTask.deleteMany({ where: { jobId: id } });
    await m.client.timeLog.deleteMany({ where: { jobId: id } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: id } });
    await m.client.job.deleteMany({ where: { id } });
    await m.client.property.deleteMany({ where: { id } });
    await m.client.user.deleteMany({ where: { id } });
    await m.client.client.deleteMany({ where: { id } });
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(0);
  });
  afterAll(async () => { await m.client?.$disconnect(); });

  it("commits one confirmation through the real service and makes duplicate retries idempotent", async () => {
    expect((await POST(request(), { params: { id } })).status).toBe(200);
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id, s3Key: "fixture-key" } })).toBe(1);
    expect((await POST(request(), { params: { id } })).status).toBe(200);
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(1);
    expect(m.deliver).toHaveBeenCalledOnce(); // Mock only: no network/provider integration.
  });
  it("reports saved state when post-commit delivery fails and does not blindly resend on retry", async () => {
    m.deliver.mockRejectedValueOnce(new Error("Delivery response lost"));
    const response = await POST(request(), { params: { id } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicated: false, status: "CONFIRMED", deliveryWarning: expect.stringContaining("update saved") });
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(1);
    const retried = await POST(request(), { params: { id } });
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ ok: true, duplicated: true });
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(1);
    expect(m.deliver).toHaveBeenCalledOnce();
  });
  it("waits for a driver task lock and preserves the pickup committed before the handoff read", async () => {
    const acquired = deferred(), release = deferred();
    const driver = m.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "jobId" = ${id} FOR UPDATE`;
      await tx.laundryTask.update({ where: { id }, data: { status: "PICKED_UP", pickedUpAt: new Date() } });
      acquired.resolve(); await release.promise;
    });
    await acquired.promise;
    let settled = false;
    const send = POST(request(), { params: { id } }).then(response => { settled = true; return response; });
    try {
      await new Promise(done => setTimeout(done, 30));
      expect(settled).toBe(false);
    } finally { release.resolve(); }
    await driver;
    const response = await send;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicated: true, status: "PICKED_UP" });
    expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("PICKED_UP");
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(0);
    expect(m.deliver).not.toHaveBeenCalled();
  });
  it("creates a missing task using the existing planner within the same transaction", async () => {
    await m.client.laundryTask.delete({ where: { id } });
    expect((await POST(request(), { params: { id } })).status).toBe(200);
    const task = await m.client.laundryTask.findUnique({ where: { jobId: id } });
    expect(task.status).toBe("CONFIRMED");
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: task.id } })).toBe(1);
    // The planner owns its task ID; cleanup it before the common fixture teardown.
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: task.id } });
    await m.client.laundryTask.delete({ where: { id: task.id } });
  });
  it.each(["detach", "attach"])("waits for a competing %s transaction and rejects the stale handoff", async mutation => {
    const acquired = deferred(), release = deferred();
    const competing = withSharedCleanerJobDraftLock(id, async tx => {
      const draft = (await getSharedCleanerJobDraft(id, tx))!;
      const receipts = draft.evidenceReceipts!;
      if (mutation === "detach") {
        receipts.capture = { ...receipts.capture, detached: true };
        draft.state = removeEvidenceKeys(draft.state, new Set(["fixture-key"]));
      } else receipts.second = { ...receipts.capture, key: "second-key" };
      await saveSharedCleanerJobDraft(id, draft, tx);
      acquired.resolve(); await release.promise;
    });
    await acquired.promise;
    let settled = false;
    const send = POST(request(), { params: { id } }).then(response => { settled = true; return response; });
    try {
      await new Promise(done => setTimeout(done, 30));
      expect(settled).toBe(false);
    } finally { release.resolve(); }
    await competing;
    expect((await send).status).toBe(409);
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(0);
    expect(m.deliver).not.toHaveBeenCalled();
  });
});
