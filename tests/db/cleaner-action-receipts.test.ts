// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ client: null as any, actor: "", earlyAllowed: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: m.actor } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountability: { requireJobStartConfirmation: false } }), getTransactionAppSettings: async () => ({ clockOutWithoutFormAllowedCleanerIds: m.earlyAllowed ? [m.actor] : [] }) }));
vi.mock("@/lib/notifications/client-job-notifications", () => ({ sendClientJobNotification: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/admin-alerts", () => ({ notifyAdminsByPush: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: vi.fn(async () => {}) }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: async () => [] }));
import { withCleanerAction, recoverCleanerAction } from "@/lib/cleaner/action-receipt";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import { withSharedCleanerJobDraftLock } from "@/lib/cleaner/shared-job-draft";
import { POST as stop } from "@/app/api/cleaner/jobs/[id]/stop/route";
import { POST as earlyOut } from "@/app/api/cleaner/jobs/[id]/clock-out-early/route";
import { POST as start } from "@/app/api/cleaner/jobs/[id]/start/route";
import { POST as gpsCheckin } from "@/app/api/cleaner/jobs/[id]/gps-checkin/route";
import { POST as assignmentResponse } from "@/app/api/cleaner/jobs/[id]/assignment-response/route";
const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
function context(requestId = randomUUID()) { return { session: { user: { id } }, jobId: id, action: "stop" as const, requestId, body: {}, draftIdentity: cleanerDraftIdentity({ user: { id } }, id) }; }
function request(requestId: string) { return new NextRequest("http://localhost/action", { method: "POST", headers: { "X-Cleaner-Action-Id": requestId, "X-Cleaner-Draft-Identity": cleanerDraftIdentity({ user: { id } }, id) } }); }
function gate() { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; }
describe.skipIf(!url)("cleaner action receipts and cancellation fences (loopback PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol) || Array.from(parsed.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Explicit loopback test database required");
    m.client = new PrismaClient({ datasources: { db: { url } } }); await m.client.$connect();
  });
  beforeEach(async () => {
    id = `qa-action-${randomUUID()}`; m.actor = id; m.earlyAllowed = true;
    await m.client.client.create({ data: { id, name: "Action verification" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER" } });
    await m.client.property.create({ data: { id, clientId: id, name: "Action verification", address: "1 Fixture Street", suburb: "Sydney" } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "GENERAL_CLEAN", status: "IN_PROGRESS", scheduledDate: new Date() } });
    await m.client.jobAssignment.create({ data: { jobId: id, userId: id } });
    await m.client.timeLog.create({ data: { jobId: id, userId: id, startedAt: new Date(Date.now() - 600_000) } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    const identity = cleanerDraftIdentity({ user: { id } }, id);
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "cleaner_action_v1:" }, value: { path: ["identity"], equals: identity } } });
    await m.client.auditLog.deleteMany({ where: { jobId: id } });
    await m.client.timeLog.deleteMany({ where: { jobId: id } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: id } });
    await m.client.job.deleteMany({ where: { id } }); await m.client.property.deleteMany({ where: { id } });
    await m.client.user.deleteMany({ where: { id } }); await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => m.client?.$disconnect());
  it.each(["SUBMITTED", "COMPLETED", "SKIPPED"])("does not mutate arrival evidence for %s work", async state => {
    await m.client.job.update({ where: { id }, data: state === "SKIPPED" ? { cleanSkipStatus: "SKIPPED" } : { status: state } });
    const response = await gpsCheckin(new NextRequest("http://localhost/gps-checkin", { method: "POST", headers: request(randomUUID()).headers, body: JSON.stringify({ lat: -33.8, lng: 151.2, adjusted: true }) }), { params: { id } });
    expect(response.status).toBe(409);
    expect((await m.client.job.findUnique({ where: { id } })).gpsCheckInAt).toBeNull();
    expect(await m.client.auditLog.count({ where: { jobId: id } })).toBe(0);
  });
  it("rechecks early-out permission after the request lock and preserves the clock on revocation", async () => {
    const entered = gate(); const release = gate();
    const holder = withSharedCleanerJobDraftLock(id, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const pending = earlyOut(request(randomUUID()), { params: { id } });
    m.earlyAllowed = false; release.resolve(); await holder;
    expect((await pending).status).toBe(403);
    expect(await m.client.timeLog.count({ where: { jobId: id, stoppedAt: null } })).toBe(1);
  });
  it("serializes two different job starts for the same cleaner without opening two clocks", async () => {
    await stop(request(randomUUID()), { params: { id } });
    const other = `${id}-other`;
    await m.client.job.create({ data: { id: other, jobNumber: other, propertyId: id, jobType: "GENERAL_CLEAN", status: "ASSIGNED", scheduledDate: new Date() } });
    await m.client.jobAssignment.create({ data: { jobId: other, userId: id } });
    try {
      const otherIdentity = cleanerDraftIdentity({ user: { id } }, other);
      const otherRequest = new NextRequest("http://localhost/start", { method: "POST", headers: { "X-Cleaner-Action-Id": randomUUID(), "X-Cleaner-Draft-Identity": otherIdentity } });
      const results = await Promise.all([start(request(randomUUID()), { params: { id } }), start(otherRequest, { params: { id: other } })]);
      expect(results.map(result => result.status).sort(), JSON.stringify(await Promise.all(results.map(result => result.json())))).toEqual([200, 409]);
      expect(await m.client.timeLog.count({ where: { userId: id, stoppedAt: null } })).toBe(1);
    } finally {
      await m.client.appSetting.deleteMany({ where: { key: { startsWith: "cleaner_action_v1:" }, value: { path: ["identity"], equals: cleanerDraftIdentity({ user: { id } }, other) } } });
      await m.client.auditLog.deleteMany({ where: { jobId: other } }); await m.client.timeLog.deleteMany({ where: { jobId: other } });
      await m.client.jobAssignment.deleteMany({ where: { jobId: other } }); await m.client.job.delete({ where: { id: other } });
    }
  });
  it("recovers a removed cleaner's own committed decline without reopening access", async () => {
    await m.client.job.update({ where: { id }, data: { status: "OFFERED" } });
    const ctx = { ...context(), action: "assignment-response" as const, body: { action: "DECLINE" } };
    const make = () => new NextRequest("http://localhost/assignment-response", { method: "POST", headers: request(ctx.requestId).headers, body: JSON.stringify(ctx.body) });
    const first = await assignmentResponse(make(), { params: { id } });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect((await recoverCleanerAction(ctx)).result.body).toEqual(body);
    expect(await (await assignmentResponse(make(), { params: { id } })).json()).toEqual(body);
    await expect(withCleanerAction({ ...ctx, requestId: randomUUID() }, async () => ({ status: 200, body: { ok: true } }))).rejects.toThrow("Not actively assigned");
  });
  it("returns an immutable GPS receipt for the same request and fences later uncertain GPS", async () => {
    await m.client.property.update({ where: { id }, data: { latitude: -33.8, longitude: 151.2 } });
    const ctx = { ...context(), action: "gps-checkin" as const, body: { lat: -33.8, lng: 151.2, accuracy: 5 } };
    const make = () => new NextRequest("http://localhost/gps-checkin", { method: "POST", headers: request(ctx.requestId).headers, body: JSON.stringify(ctx.body) });
    const responses = await Promise.all([gpsCheckin(make(), { params: { id } }), gpsCheckin(make(), { params: { id } })]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect((await recoverCleanerAction(ctx)).state).toBe("COMMITTED");
  });
  it.each(["disabled", "revoked"])("rechecks %s cleaner authority after waiting for the draft lock", async change => {
    const entered = gate(); const release = gate();
    const holder = withSharedCleanerJobDraftLock(id, async () => { entered.resolve(); await release.promise; });
    await entered.promise;
    const mutate = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    const attempt = withCleanerAction(context(), mutate).then(() => null, error => error);
    await m.client.user.update({ where: { id }, data: change === "disabled" ? { isActive: false } : { role: "CLIENT" } });
    release.resolve(); await holder;
    expect((await attempt).message).toContain("access has changed");
    expect(mutate).not.toHaveBeenCalled();
  });
  it("accepts a currently held cleaner role without requiring it as primary", async () => {
    await m.client.user.update({ where: { id }, data: { role: "CLIENT", extraRoles: { create: { role: "CLEANER" } } } });
    expect(await withCleanerAction(context(), async () => ({ status: 200, body: { ok: true } }))).toMatchObject({ status: 200 });
  });
  it("returns the same committed pause receipt for simultaneous retries", async () => {
    const requestId = randomUUID();
    const responses = await Promise.all([stop(request(requestId), { params: { id } }), stop(request(requestId), { params: { id } })]);
    const bodies = await Promise.all(responses.map(response => response.json()));
    expect(bodies[0]).toEqual(bodies[1]); expect(bodies[0]).toMatchObject({ ok: true, alreadyStopped: false });
    expect(await m.client.timeLog.count({ where: { jobId: id, stoppedAt: null } })).toBe(0);
    expect((await m.client.job.findUnique({ where: { id } })).status).toBe("PAUSED");
  });
  it("a recovery fence prevents an original request that arrives later from mutating", async () => {
    const ctx = context(); const mutate = vi.fn();
    expect((await recoverCleanerAction(ctx)).state).toBe("CANCELLED");
    await expect(withCleanerAction(ctx, mutate)).rejects.toThrow("cancelled");
    expect(mutate).not.toHaveBeenCalled();
    expect(await m.client.timeLog.count({ where: { jobId: id, stoppedAt: null } })).toBe(1);
  });
  it("recovery waits for an original transaction and observes its committed receipt", async () => {
    const ctx = context(); const entered = gate(); const release = gate();
    const original = withCleanerAction(ctx, async tx => {
      entered.resolve(); await release.promise;
      await tx.job.update({ where: { id }, data: { status: "PAUSED" } });
      return { status: 200, body: { ok: true } };
    });
    await entered.promise;
    let recovered = false;
    const recovery = recoverCleanerAction(ctx).then(result => { recovered = true; return result; });
    await new Promise(done => setTimeout(done, 50)); expect(recovered).toBe(false);
    release.resolve(); await original;
    expect((await recovery).state).toBe("COMMITTED");
  });
  it("rolls back mutation without leaving a success receipt and rejects changed replay input", async () => {
    const ctx = context();
    await expect(withCleanerAction(ctx, async tx => { await tx.job.update({ where: { id }, data: { status: "PAUSED" } }); throw new Error("audit failed"); })).rejects.toThrow("audit failed");
    expect((await m.client.job.findUnique({ where: { id } })).status).toBe("IN_PROGRESS");
    await withCleanerAction(ctx, async () => ({ status: 200, body: { ok: true } }));
    await expect(withCleanerAction({ ...ctx, body: { changed: true } }, async () => ({ status: 200, body: {} }))).rejects.toThrow("different input");
    await m.client.jobAssignment.updateMany({ where: { jobId: id }, data: { removedAt: new Date() } });
    await expect(recoverCleanerAction(ctx)).rejects.toThrow("Not actively assigned");
  });
  it("early clock-out stores one audit and never reopens a submitted job", async () => {
    const requestId = randomUUID();
    expect((await earlyOut(request(requestId), { params: { id } })).status).toBe(200);
    expect((await earlyOut(request(requestId), { params: { id } })).status).toBe(200);
    expect(await m.client.auditLog.count({ where: { jobId: id, action: "CLOCK_OUT_EARLY" } })).toBe(1);
    await m.client.job.update({ where: { id }, data: { status: "SUBMITTED" } });
    expect((await earlyOut(request(randomUUID()), { params: { id } })).status).toBe(409);
    expect((await m.client.job.findUnique({ where: { id } })).status).toBe("SUBMITTED");
  });
  it.each(["ASSIGNED", "WAITING_CONTINUATION_APPROVAL", "SKIPPED"])("does not change %s to PAUSED on early clock-out", async state => {
    await m.client.job.update({ where: { id }, data: state === "SKIPPED" ? { cleanSkipStatus: "SKIPPED" } : { status: state } });
    expect((await earlyOut(request(randomUUID()), { params: { id } })).status).toBe(409);
    const job = await m.client.job.findUnique({ where: { id } });
    expect(job.status).toBe(state === "SKIPPED" ? "IN_PROGRESS" : state);
    expect(await m.client.auditLog.count({ where: { jobId: id } })).toBe(0);
  });
  it("simultaneous start requests share a receipt and never reopen skipped work", async () => {
    await stop(request(randomUUID()), { params: { id } });
    const requestId = randomUUID();
    const responses = await Promise.all([start(request(requestId), { params: { id } }), start(request(requestId), { params: { id } })]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect(await m.client.timeLog.count({ where: { jobId: id, stoppedAt: null } })).toBe(1);
    await stop(request(randomUUID()), { params: { id } });
    await m.client.job.update({ where: { id }, data: { cleanSkipStatus: "SKIPPED" } });
    expect((await start(request(randomUUID()), { params: { id } })).status).toBe(409);
    expect(await m.client.timeLog.count({ where: { jobId: id, stoppedAt: null } })).toBe(0);
    expect((await m.client.job.findUnique({ where: { id } })).status).toBe("PAUSED");
  });
  it("fails closed on a corrupt receipt without overwriting it", async () => {
    const ctx = context(); await withCleanerAction(ctx, async () => ({ status: 200, body: { ok: true } }));
    const identity = cleanerDraftIdentity({ user: { id } }, id);
    const row = await m.client.appSetting.findFirst({ where: { key: { startsWith: "cleaner_action_v1:" }, value: { path: ["identity"], equals: identity } } });
    const corrupt = { ...row.value, result: { status: 200, body: {} } };
    await m.client.appSetting.update({ where: { key: row.key }, data: { value: corrupt } });
    await expect(recoverCleanerAction(ctx)).rejects.toThrow("receipt is unavailable");
    expect((await m.client.appSetting.findUnique({ where: { key: row.key } })).value).toEqual(corrupt);
  });
});
