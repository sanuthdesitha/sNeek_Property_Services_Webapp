// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { enqueueNotificationIntent, claimNotificationIntent, deliverInboxIntent, finishNotificationAttempt } from "@/lib/notifications/intent-store";
import { reviewNotificationIntent } from "@/lib/notifications/intent-review";
const m = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_, key) { const value = m.db[key]; return typeof value === "function" ? value.bind(m.db) : value; } }) }));
const url = process.env.SNEEK_TEST_DATABASE_URL;
let recipient: string;
const envelope = () => ({ version: 1, eventId: `${recipient}-receipt`, eventKey: "test.intent", entity: { type: "Fixture", id: recipient }, actorId: null, recipient: { userId: recipient, role: "ADMIN", scope: { kind: "ADMIN_OPERATIONS" } }, severity: "ACTION", transport: "INBOX", subject: "Synthetic intent", body: "No provider dispatch", jobId: null });
const enqueue = (input = envelope()) => m.db.$transaction((tx: any) => enqueueNotificationIntent(tx, input));
describe.skipIf(!url)("notification intent transactions (isolated local DB)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol) || Array.from(parsed.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Loopback DB required");
    m.db = new PrismaClient({ datasources: { db: { url } } }); await m.db.$connect();
  });
  beforeEach(async () => { recipient = `qa-intent-${randomUUID()}`; await m.db.user.create({ data: { id: recipient, email: `${recipient}@example.invalid`, role: "ADMIN" } }); });
  afterEach(async () => {
    await m.db.auditLog.deleteMany({ where: { userId: recipient, entity: "NotificationIntent" } });
    await m.db.notificationAttempt.deleteMany({ where: { intent: { recipientId: recipient } } });
    await m.db.notificationIntent.deleteMany({ where: { recipientId: recipient } });
    await m.db.notification.deleteMany({ where: { userId: recipient } });
    await m.db.user.deleteMany({ where: { id: recipient } });
  });
  afterAll(async () => { await m.db?.$disconnect(); });
  it("concurrent same-event enqueues create one intent; changed payload conflicts", async () => {
    const results = await Promise.all([enqueue(), enqueue()]); expect(results[0].id).toBe(results[1].id);
    expect(await m.db.notificationIntent.count({ where: { recipientId: recipient } })).toBe(1);
    await expect(enqueue({ ...envelope(), body: "changed" })).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back queued intent with its domain transaction", async () => {
    await expect(m.db.$transaction(async (tx: any) => { await enqueueNotificationIntent(tx, envelope()); throw new Error("domain rollback"); })).rejects.toThrow("domain rollback");
    expect(await m.db.notificationIntent.count({ where: { recipientId: recipient } })).toBe(0);
  });
  it("concurrent claims allow exactly one atomic inbox acceptance", async () => {
    const queued = await enqueue(); const claims = await Promise.all([claimNotificationIntent(queued.id, new Date(Date.now() + 1000)), claimNotificationIntent(queued.id, new Date(Date.now() + 1000))]);
    const claim = claims.find(Boolean)!; expect(claims.filter(Boolean)).toHaveLength(1);
    await deliverInboxIntent(claim.id, claim.leaseToken!);
    expect(await m.db.notification.count({ where: { userId: recipient } })).toBe(1);
    expect(await m.db.notificationIntent.findUnique({ where: { id: claim.id } })).toMatchObject({ status: "ACCEPTED", attemptCount: 1, notificationId: `intent-${claim.id}` });
    expect(await m.db.notificationAttempt.findMany({ where: { intentId: claim.id } })).toMatchObject([{ status: "ACCEPTED", providerReference: null }]);
    await expect(deliverInboxIntent(claim.id, claim.leaseToken!)).rejects.toMatchObject({ status: 409 });
  });
  it.each([false, true])("rechecks recipient active status and role (role change %s)", async roleChange => {
    const queued = await enqueue(); const claim = (await claimNotificationIntent(queued.id, new Date(Date.now() + 1000)))!;
    await m.db.user.update({ where: { id: recipient }, data: roleChange ? { role: "CLIENT" } : { isActive: false } });
    await deliverInboxIntent(claim.id, claim.leaseToken!);
    expect(await m.db.notification.count({ where: { userId: recipient } })).toBe(0);
    expect(await m.db.notificationIntent.findUnique({ where: { id: claim.id } })).toMatchObject({ status: "SKIPPED", lastErrorCode: "recipient_unavailable" });
  });
  it("uncertain attempts are not reclaimed, including stale completion callbacks", async () => {
    const queued = await enqueue(); const claim = (await claimNotificationIntent(queued.id, new Date(Date.now() + 1000)))!;
    await finishNotificationAttempt(claim.id, claim.leaseToken!, { kind: "UNCERTAIN", errorCode: "transport_timeout" });
    expect(await claimNotificationIntent(claim.id, new Date(Date.now() + 86400000))).toBeNull();
    await expect(finishNotificationAttempt(claim.id, claim.leaseToken!, { kind: "ACCEPTED" })).rejects.toMatchObject({ status: 409 });
  });
  it("records investigation without resending uncertainty and rejects stale review", async () => {
    const queued = await enqueue(); const claim = (await claimNotificationIntent(queued.id, new Date(Date.now() + 1000)))!;
    const uncertain = await finishNotificationAttempt(claim.id, claim.leaseToken!, { kind: "UNCERTAIN", errorCode: "timeout" });
    const request = { id: claim.id, updatedAt: uncertain.updatedAt.toISOString(), action: "RECORD_INVESTIGATION", note: "Checked the receipt" };
    expect(await reviewNotificationIntent(recipient, request)).toMatchObject({ status: "UNCERTAIN" });
    await expect(reviewNotificationIntent(recipient, request)).rejects.toMatchObject({ status: 409 });
    expect(await m.db.auditLog.count({ where: { userId: recipient, entityId: claim.id } })).toBe(1);
    expect(await m.db.notification.count({ where: { userId: recipient } })).toBe(0);
    await m.db.auditLog.deleteMany({ where: { userId: recipient, entityId: claim.id } });
  });
  it("reconciles only local atomic inbox absence, never unknown external delivery", async () => {
    const queued = await enqueue(); const claim = (await claimNotificationIntent(queued.id, new Date(Date.now() + 1000)))!;
    const uncertain = await finishNotificationAttempt(claim.id, claim.leaseToken!, { kind: "UNCERTAIN", errorCode: "timeout" });
    const request = { id: claim.id, updatedAt: uncertain.updatedAt.toISOString(), action: "RECONCILE_INBOX", note: "Check atomic receipt" };
    expect(await reviewNotificationIntent(recipient, request)).toMatchObject({ status: "RETRY_WAIT" });
    const external = await enqueue({ ...envelope(), transport: "EMAIL" }); const extClaim = (await claimNotificationIntent(external.id, new Date(Date.now() + 1000)))!;
    const extUncertain = await finishNotificationAttempt(external.id, extClaim.leaseToken!, { kind: "UNCERTAIN", errorCode: "timeout" });
    await expect(reviewNotificationIntent(recipient, { ...request, id: external.id, updatedAt: extUncertain.updatedAt.toISOString() })).rejects.toMatchObject({ status: 409 });
    await m.db.auditLog.deleteMany({ where: { userId: recipient, entity: "NotificationIntent" } });
  });
  it("audit failure rolls back a reviewed retry", async () => {
    const queued = await enqueue(); const claim = (await claimNotificationIntent(queued.id, new Date(Date.now() + 1000)))!;
    const failed = await finishNotificationAttempt(claim.id, claim.leaseToken!, { kind: "NOT_ACCEPTED", retryable: false, errorCode: "config" });
    await expect(reviewNotificationIntent("missing-actor", { id: claim.id, updatedAt: failed.updatedAt.toISOString(), action: "RETRY_KNOWN_REJECTION", note: "Configuration repaired" })).rejects.toThrow();
    expect(await m.db.notificationIntent.findUnique({ where: { id: claim.id } })).toMatchObject({ status: "FAILED" });
  });
  it("only known rejection retries and terminates at the bound", async () => {
    const queued = await enqueue(); let now = new Date(Date.now() + 1000);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = (await claimNotificationIntent(queued.id, now))!;
      const result = await finishNotificationAttempt(claim.id, claim.leaseToken!, { kind: "NOT_ACCEPTED", retryable: true, errorCode: "temporary_rejection" }, now);
      expect(result.status).toBe(attempt === 5 ? "FAILED" : "RETRY_WAIT");
      expect(await claimNotificationIntent(claim.id, now)).toBeNull();
      now = new Date(now.getTime() + 3600000);
    }
    expect(await m.db.notificationAttempt.count({ where: { intentId: queued.id } })).toBe(5);
    expect(await m.db.notification.count({ where: { userId: recipient } })).toBe(0);
  });
});
