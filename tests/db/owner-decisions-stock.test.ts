// @vitest-environment node
/**
 * Owner decisions 2026-11-12 on a real PostgreSQL database
 * (SNEEK_TEST_DATABASE_URL, loopback 55439):
 *  1. operations managers with the inventory pack at "manage" Resolve, bulk
 *     Close and change the reminder settings; "read" is refused; an
 *     impersonated manager keeps their own rights; the audit names the role
 *     and the impersonating administrator;
 *  2. "urgent need opened" goes to administrators and to managers whose pack
 *     allows at least read, once per person, re-checked at dispatch, with
 *     personal preferences honoured;
 *  3. a reset with applied stock counts needs the office's choice; Reverse
 *     restores the replaced value unless a newer record exists; Keep leaves
 *     them; a path nobody decides keeps them and records that.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, session: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", async (importOriginal) => ({ ...(await importOriginal<object>()), getAppSettings: async () => ({ timezone: "Australia/Sydney", notificationDefaults: { categories: {} }, cleanerPortalVisibility: { showShopping: true } }) }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => m.session, requireSession: async () => m.session }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: async () => undefined }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: async () => undefined }));

import { actOnUrgentStock, listUrgentStock, reportUrgentStock, setUrgentStockSettings } from "@/lib/inventory/urgent-stock";
import { runUrgentStockBulk } from "@/lib/inventory/urgent-stock-bulk";
import { claimNotificationIntent, deliverInboxIntent } from "@/lib/notifications/intent-store";
import { recordStockCountObservations } from "@/lib/inventory/stock-count-observations";
import { applyJobRotationCompletion } from "@/lib/accountability/rotation";
import { keepAppliedCountsWithoutChoice, resolveAppliedCountsOnReset, StockCountChoiceRequiredError } from "@/lib/inventory/stock-count-reset";
import { POST as resetJob, GET as resetContext } from "@/app/api/admin/jobs/[id]/reset/route";
import { POST as qaReset } from "@/app/api/admin/jobs/[id]/qa-reset/route";
import { PATCH as patchJob } from "@/app/api/admin/jobs/[id]/route";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const id = (name: string) => `od-${tag}-${name}`;
const admin = { id: id("admin"), role: Role.ADMIN };
const opsManage = { id: id("ops-manage"), role: Role.OPS_MANAGER };
const opsRead = { id: id("ops-read"), role: Role.OPS_MANAGER };
const opsOff = { id: id("ops-off"), role: Role.OPS_MANAGER };
const opsAdmin = { id: id("ops-admin"), role: Role.OPS_MANAGER };
const opsMuted = { id: id("ops-muted"), role: Role.OPS_MANAGER };
const cleaner = { id: id("cleaner"), role: Role.CLEANER };
const users = [admin, opsManage, opsRead, opsOff, opsAdmin, opsMuted, cleaner];
const userIds = users.map((user) => user.id);
const propertyId = id("property");
const soapId = id("soap");
const towelId = id("towel");
const jobId = id("job");
const templateId = id("template");
const OPS_KEY = "ops_feature_permissions_v1";
const SETTINGS_KEY = "urgent_stock_v1:settings";

async function setPacks(levels: Record<string, "off" | "read" | "manage">) {
  const assignments = Object.fromEntries(Object.entries(levels).map(([userId, inventory]) => [userId, { presetId: "existing", overrides: { inventory } }]));
  const value = { revision: 1, presets: [], assignments };
  await m.client.appSetting.upsert({ where: { key: OPS_KEY }, create: { key: OPS_KEY, value }, update: { value } });
}
const defaultPacks = () => setPacks({ [opsManage.id]: "manage", [opsRead.id]: "read", [opsOff.id]: "off", [opsMuted.id]: "read" });
function needInput(extra: Record<string, unknown> = {}) {
  return { propertyId, itemId: soapId, requestId: randomUUID(), observedCount: null, observedAt: null, purchaseQuantity: 6, note: "Fixture need", ...extra };
}
function resolveInput(need: { id: string; version: number }) {
  return { reportId: need.id, requestId: randomUUID(), expectedVersion: need.version, stage: "ADMIN_RESOLVED", reason: "No longer needed", observedCount: null, observedAt: null, needResolved: false };
}
function jsonRequest(body: unknown) {
  return new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as never;
}

/** A COMPLETED job whose form counted soap = 3 and towels = 5, applied on approval. */
async function approvedJobWithCounts() {
  const submission = await m.client.formSubmission.create({ data: { jobId, templateId, submittedById: cleaner.id, data: {}, createdAt: new Date(Date.now() - 60_000) } });
  await m.client.job.update({ where: { id: jobId }, data: { status: "SUBMITTED" } });
  const counts = [
    { fieldId: "soap", label: "Soap left", itemId: soapId, itemName: "Soap", unit: "bottle", count: 3 },
    { fieldId: "towel", label: "Towels left", itemId: towelId, itemName: "Towels", unit: null, count: 5 },
  ];
  await m.client.$transaction((tx) => recordStockCountObservations(tx, { submissionId: submission.id, jobId, propertyId, observedAt: submission.createdAt, counts }));
  await m.client.job.update({ where: { id: jobId }, data: { status: "COMPLETED", completedAt: new Date() } });
  await m.client.$transaction((tx) => applyJobRotationCompletion(tx, { jobId, propertyId }));
  return submission;
}
async function onHand(itemId: string) {
  return (await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId } })).onHand;
}

describe.skipIf(!url)("owner decisions 2026-11-12: urgent stock rights, need-opened notice, applied counts on reset", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: users.map((user) => ({ id: user.id, email: `${user.id}@example.invalid`, name: user.id, role: user.role })) });
    await m.client.userRole.create({ data: { userId: opsAdmin.id, role: Role.ADMIN } });
    await m.client.userNotificationPreference.create({ data: { userId: opsMuted.id, categories: { shopping: { web: false, email: false, sms: false } } } });
    await m.client.client.create({ data: { id: id("client"), name: "Decisions client" } });
    await m.client.property.create({ data: { id: propertyId, name: "Decisions property", clientId: id("client"), address: "1 Fixture St", suburb: "Fixture", inventoryEnabled: true } });
    await m.client.inventoryItem.createMany({ data: [{ id: soapId, name: "Soap", category: "Fixture", unit: "bottle" }, { id: towelId, name: "Towels", category: "Fixture" }] });
    await m.client.propertyStock.createMany({ data: [{ propertyId, itemId: soapId, onHand: 10 }, { propertyId, itemId: towelId, onHand: 8 }] });
    await m.client.formTemplate.create({ data: { id: templateId, name: "Decisions", serviceType: "AIRBNB_TURNOVER", schema: {} } });
    await m.client.job.create({ data: { id: jobId, jobNumber: id("J"), propertyId, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date(Date.now() + 86_400_000), assignments: { create: { userId: cleaner.id, responseStatus: "ACCEPTED" } } } });
  });
  beforeEach(async () => {
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "urgent_stock_v1:" } } });
    await m.client.notification.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.notificationAttempt.deleteMany({ where: { intent: { recipientId: { in: userIds } } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: userIds } } });
    await m.client.stockCountObservation.deleteMany({ where: { propertyId } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
    await m.client.formSubmission.deleteMany({ where: { jobId } });
    await m.client.qaAssignment.deleteMany({ where: { jobId } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.propertyStock.updateMany({ where: { propertyId, itemId: soapId }, data: { onHand: 10 } });
    await m.client.propertyStock.updateMany({ where: { propertyId, itemId: towelId }, data: { onHand: 8 } });
    await m.client.job.update({ where: { id: jobId }, data: { status: "ASSIGNED", completedAt: null } });
    await defaultPacks();
    m.session = { user: { id: admin.id, role: Role.ADMIN, heldRoles: [Role.ADMIN] } };
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId } });
    await m.client.appSetting.deleteMany({ where: { key: { in: [OPS_KEY, SETTINGS_KEY] } } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "urgent_stock_v1:" } } });
    await m.client.notification.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.notificationAttempt.deleteMany({ where: { intent: { recipientId: { in: userIds } } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: userIds } } });
    await m.client.stockCountObservation.deleteMany({ where: { propertyId } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
    await m.client.formSubmission.deleteMany({ where: { jobId } });
    await m.client.qaAssignment.deleteMany({ where: { jobId } });
    await m.client.jobAssignment.deleteMany({ where: { jobId } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { jobId }] } });
    await m.client.job.deleteMany({ where: { id: jobId } });
    await m.client.propertyStock.deleteMany({ where: { propertyId } });
    await m.client.inventoryItem.deleteMany({ where: { id: { in: [soapId, towelId] } } });
    await m.client.formTemplate.deleteMany({ where: { id: templateId } });
    await m.client.property.deleteMany({ where: { id: propertyId } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.userNotificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.user.deleteMany({ where: { id: { in: userIds } } });
    await m.client.$disconnect();
  });

  describe("decision 1: Resolve, bulk Close and reminder settings by the inventory pack", () => {
    it("lets a manager with the pack at manage Resolve and bulk Close; read is refused for both", async () => {
      const first = await reportUrgentStock(admin, needInput());
      await expect(actOnUrgentStock(opsRead, resolveInput(first))).rejects.toThrow("FORBIDDEN");
      const resolved = await actOnUrgentStock(opsManage, resolveInput(first));
      expect(resolved.stage).toBe("ADMIN_RESOLVED");
      const event = await m.client.urgentStockEvent.findFirstOrThrow({ where: { needId: first.id, kind: "ADMIN_RESOLVED" } });
      expect(event).toMatchObject({ actorId: opsManage.id, detail: expect.objectContaining({ actorRole: "OPS_MANAGER", impersonatedBy: null }) });

      const second = await reportUrgentStock(admin, needInput());
      const bulkBody = (actor: typeof opsRead) => runUrgentStockBulk(actor, { action: "close", bulkRequestId: randomUUID(), reason: "Covered", needs: [{ id: second.id, expectedVersion: second.version }] });
      await expect(bulkBody(opsRead)).rejects.toThrow("FORBIDDEN");
      const closed = await bulkBody(opsManage);
      expect(closed.results).toEqual([expect.objectContaining({ id: second.id, outcome: "done" })]);
    });

    it("lets a manager with manage change and read the reminder settings, audited with role; read is refused and sees none", async () => {
      const value = { enabled: true, intervalHours: 12, maxReminders: 3, beforeNextCleanHours: 24 };
      await expect(setUrgentStockSettings(opsRead, value)).rejects.toThrow("FORBIDDEN");
      expect((await listUrgentStock(opsRead)).settings).toBeNull();
      expect(await setUrgentStockSettings(opsManage, value)).toEqual(value);
      expect((await listUrgentStock(opsManage)).settings).toEqual(value);
      const audit = await m.client.auditLog.findFirstOrThrow({ where: { userId: opsManage.id, action: "URGENT_STOCK_REMINDERS_UPDATED" } });
      expect(audit.after).toMatchObject({ ...value, actorRole: "OPS_MANAGER", impersonatedBy: null });
      // ADMIN unchanged.
      expect(await setUrgentStockSettings(admin, { ...value, enabled: false })).toEqual({ ...value, enabled: false });
    });

    it("never goes beyond the impersonated manager's own rights, and ignores client-supplied roles", async () => {
      const need = await reportUrgentStock(admin, needInput());
      // An administrator viewing as a read-only manager: the target's pack applies.
      const impersonated = { ...opsRead, heldRoles: ["ADMIN"], impersonatedBy: admin.id };
      await expect(actOnUrgentStock(impersonated, resolveInput(need))).rejects.toThrow("FORBIDDEN");
      await expect(setUrgentStockSettings(impersonated, { enabled: true, intervalHours: 1, maxReminders: 1, beforeNextCleanHours: 1 })).rejects.toThrow("FORBIDDEN");
      // Viewing as a manager with manage: allowed, and the audit names the administrator behind it.
      await setUrgentStockSettings({ ...opsManage, impersonatedBy: admin.id }, { enabled: true, intervalHours: 2, maxReminders: 1, beforeNextCleanHours: 1 });
      const audit = await m.client.auditLog.findFirstOrThrow({ where: { userId: opsManage.id, action: "URGENT_STOCK_REMINDERS_UPDATED" } });
      expect(audit.after).toMatchObject({ actorRole: "OPS_MANAGER", impersonatedBy: admin.id });
      // A revoked pack takes effect at once.
      await setPacks({ [opsManage.id]: "read" });
      await expect(actOnUrgentStock(opsManage, resolveInput(need))).rejects.toThrow("FORBIDDEN");
    });
  });

  describe("decision 2: the need-opened notice reaches managers with the pack", () => {
    it("queues one inbox notice per person: admins and managers with read or manage, not off; a manager who is also ADMIN once", async () => {
      const need = await reportUrgentStock(cleaner, needInput());
      const intents = await m.client.notificationIntent.findMany({ where: { recipientId: { in: userIds }, eventKey: "urgent_stock.open_need" } });
      const recipients = intents.map((row) => row.recipientId).sort();
      expect(recipients).toEqual([admin.id, opsAdmin.id, opsManage.id, opsMuted.id, opsRead.id].sort());
      expect(new Set(recipients).size).toBe(recipients.length);
      for (const intent of intents) {
        expect(intent.transport).toBe("INBOX");
        expect(intent.envelope).toMatchObject({ category: "shopping", recipient: { scope: { kind: "ENTITY", type: "URGENT_STOCK_OFFICE", id: need.id } } });
      }
    });

    it("re-checks the pack at dispatch and honours personal preferences", async () => {
      await reportUrgentStock(cleaner, needInput());
      // The read-only manager's pack is turned off after queueing.
      await setPacks({ [opsManage.id]: "manage", [opsRead.id]: "off", [opsMuted.id]: "read" });
      const deliver = async (userId: string) => {
        const intent = await m.client.notificationIntent.findFirstOrThrow({ where: { recipientId: userId, eventKey: "urgent_stock.open_need" } });
        const claimed = await claimNotificationIntent(intent.id);
        await deliverInboxIntent(intent.id, claimed!.leaseToken!);
        return m.client.notificationIntent.findUniqueOrThrow({ where: { id: intent.id }, include: { attempts: true } });
      };
      expect((await deliver(opsManage.id)).status).toBe("ACCEPTED");
      expect(await m.client.notification.count({ where: { userId: opsManage.id } })).toBe(1);
      const revoked = await deliver(opsRead.id);
      expect(revoked.attempts[0]).toMatchObject({ status: "SKIPPED", errorCode: "recipient_not_in_scope" });
      expect(await m.client.notification.count({ where: { userId: opsRead.id } })).toBe(0);
      const muted = await deliver(opsMuted.id);
      expect(muted.attempts[0]).toMatchObject({ status: "SKIPPED", errorCode: "recipient_preference" });
      expect((await deliver(admin.id)).status).toBe("ACCEPTED");
    });
  });

  describe("decision 3: applied stock counts when a job is reset", () => {
    const actor = { id: admin.id, role: "ADMIN", impersonatedBy: null };

    it("requires an explicit choice that names the applied counts", async () => {
      await approvedJobWithCounts();
      expect(await onHand(soapId)).toBe(3);
      const attempt = m.client.$transaction((tx) => resolveAppliedCountsOnReset(tx, { jobId, choice: null, actor, path: "test" }));
      await expect(attempt).rejects.toBeInstanceOf(StockCountChoiceRequiredError);
      await expect(m.client.$transaction((tx) => resolveAppliedCountsOnReset(tx, { jobId, choice: null, actor, path: "test" }))).rejects.toThrow(/Soap \(counted 3 bottle, on hand now 3 bottle\)/);
      expect(await onHand(soapId)).toBe(3);
    });

    it("Reverse restores the replaced value, marks the count reversed and keeps every ledger row; a newer record is not reversed", async () => {
      await approvedJobWithCounts();
      // Towels: a delivery after the count.
      const towelStock = await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId: towelId } });
      await m.client.stockTx.create({ data: { propertyStockId: towelStock.id, txType: "RESTOCKED", quantity: 4, notes: "Delivery", createdAt: new Date(Date.now() + 1000) } });
      await m.client.propertyStock.update({ where: { id: towelStock.id }, data: { onHand: 9 } });
      const result = await m.client.$transaction((tx) => resolveAppliedCountsOnReset(tx, { jobId, choice: "REVERSE", actor, path: "test" }));
      const byItem = Object.fromEntries(result.outcomes.map((row) => [row.itemId, row]));
      expect(byItem[soapId]).toMatchObject({ outcome: "REVERSED", onHandBefore: 3, onHandAfter: 10 });
      expect(byItem[towelId]).toMatchObject({ outcome: "NOT_REVERSED_NEWER_RECORD", onHandAfter: 9 });
      expect(await onHand(soapId)).toBe(10);
      expect(await onHand(towelId)).toBe(9);
      const soap = await m.client.stockCountObservation.findFirstOrThrow({ where: { jobId, itemId: soapId } });
      expect(soap).toMatchObject({ status: "REVERSED", previousOnHand: 10 });
      expect(soap.reason).toMatch(/Reversed: on-hand restored from 3 to 10/);
      const towel = await m.client.stockCountObservation.findFirstOrThrow({ where: { jobId, itemId: towelId } });
      expect(towel.status).toBe("APPLIED");
      expect(towel.reason).toMatch(/Not reversed: a newer stock record/);
      const soapLedger = await m.client.stockTx.findMany({ where: { propertyStock: { propertyId, itemId: soapId } }, orderBy: { createdAt: "asc" } });
      expect(soapLedger.map((row) => [row.txType, row.quantity])).toEqual([["ADJUSTED", -7], ["ADJUSTED", 7]]);
      const audit = await m.client.auditLog.findFirstOrThrow({ where: { jobId, action: "STOCK_COUNTS_RESET_DECISION" } });
      expect(audit.after).toMatchObject({ choice: "REVERSE", actorRole: "ADMIN", path: "test" });
      // A reversed count is never applied again by a later approval.
      await m.client.$transaction((tx) => applyJobRotationCompletion(tx, { jobId, propertyId }));
      expect(await onHand(soapId)).toBe(10);
    });

    it("Keep leaves on-hand as counted and records the decision", async () => {
      await approvedJobWithCounts();
      const result = await m.client.$transaction((tx) => resolveAppliedCountsOnReset(tx, { jobId, choice: "KEEP", actor, path: "test" }));
      expect(result.outcomes.map((row) => row.outcome)).toEqual(["KEPT", "KEPT"]);
      expect(await onHand(soapId)).toBe(3);
      expect(await onHand(towelId)).toBe(5);
      const rows = await m.client.stockCountObservation.findMany({ where: { jobId } });
      expect(rows.every((row) => row.status === "APPLIED" && /Kept: the office chose/.test(row.reason ?? ""))).toBe(true);
    });

    it("a path nobody decides keeps the counts and records that no choice was made", async () => {
      await approvedJobWithCounts();
      expect(await m.client.$transaction((tx) => keepAppliedCountsWithoutChoice(tx, { jobId, fromStatus: "SUBMITTED", toStatus: "QA_REVIEW", path: "QA result recomputed" }))).toBe(0);
      expect(await m.client.$transaction((tx) => keepAppliedCountsWithoutChoice(tx, { jobId, fromStatus: "COMPLETED", toStatus: "QA_REVIEW", path: "QA result recomputed" }))).toBe(2);
      expect(await onHand(soapId)).toBe(3);
      const rows = await m.client.stockCountObservation.findMany({ where: { jobId } });
      expect(rows.every((row) => row.status === "APPLIED" && /without an office choice/.test(row.reason ?? ""))).toBe(true);
      expect(await m.client.auditLog.count({ where: { jobId, action: "STOCK_COUNTS_KEPT_NO_CHOICE" } })).toBe(0);
    });

    it("Reset job: GET lists the counts, POST without a choice is 409 naming them, with Reverse it resets and restores", async () => {
      await approvedJobWithCounts();
      const context = await (await resetContext(new Request("http://localhost") as never, { params: { id: jobId } })).json();
      expect(context.appliedStockCounts.map((row: { itemName: string; count: number; onHandNow: number }) => [row.itemName, row.count, row.onHandNow])).toEqual([["Soap", 3, 3], ["Towels", 5, 5]]);
      const refused = await resetJob(jsonRequest({ options: {}, confirmProtected: true }), { params: { id: jobId } });
      expect(refused.status).toBe(409);
      const body = await refused.json();
      expect(body.code).toBe("STOCK_COUNT_CHOICE_REQUIRED");
      expect(body.error).toMatch(/Soap/);
      expect((await m.client.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("COMPLETED");
      const done = await resetJob(jsonRequest({ options: {}, confirmProtected: true, appliedStockCounts: "REVERSE" }), { params: { id: jobId } });
      expect(done.status).toBe(200);
      expect((await done.json()).stockCounts.outcomes.map((row: { outcome: string }) => row.outcome)).toEqual(["REVERSED", "REVERSED"]);
      expect(await onHand(soapId)).toBe(10);
      expect(await onHand(towelId)).toBe(8);
      expect((await m.client.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ASSIGNED");
    });

    it("Reset job with Clear form data and Keep: the count's ledger row survives, its older usage is not added back", async () => {
      const submission = await approvedJobWithCounts();
      const soapStock = await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId: soapId } });
      // Usage recorded by the same submission before the count.
      await m.client.stockTx.create({ data: { propertyStockId: soapStock.id, submissionId: submission.id, txType: "USED", quantity: -2, createdAt: new Date(Date.now() - 50_000) } });
      const done = await resetJob(jsonRequest({ options: { clearFormData: true }, confirmProtected: true, appliedStockCounts: "KEEP", security: { pin: "0000" } }), { params: { id: jobId } });
      expect(done.status).toBe(200);
      expect(await onHand(soapId)).toBe(3);
      const ledger = await m.client.stockTx.findMany({ where: { propertyStockId: soapStock.id } });
      expect(ledger).toEqual([expect.objectContaining({ txType: "ADJUSTED", quantity: -7, submissionId: null })]);
      const audit = await m.client.auditLog.findFirstOrThrow({ where: { jobId, action: "JOB_RESET_OPTIONS" } });
      expect(audit.after).toMatchObject({ stockCounts: { choice: "KEEP" } });
    });

    it("a status edit out of Completed is refused (409 naming the counts) until a choice is sent", async () => {
      await approvedJobWithCounts();
      const patch = (body: unknown) => patchJob(new Request("http://localhost", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as never, { params: { id: jobId } });
      const refused = await patch({ status: "ASSIGNED" });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toMatch(/Soap.*Use Reset job/);
      expect((await m.client.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("COMPLETED");
      const done = await patch({ status: "ASSIGNED", appliedStockCounts: "KEEP" });
      expect(done.status).toBe(200);
      expect((await m.client.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("ASSIGNED");
      expect(await onHand(soapId)).toBe(3);
      expect(await m.client.auditLog.count({ where: { jobId, action: "STOCK_COUNTS_RESET_DECISION" } })).toBe(1);
    });

    it("QA reset: 409 without a choice, Keep proceeds", async () => {
      await approvedJobWithCounts();
      const refused = await qaReset(jsonRequest({ confirm: true, reason: "Wrong inspection recorded" }), { params: { id: jobId } });
      expect(refused.status).toBe(409);
      expect((await refused.json()).appliedStockCounts).toHaveLength(2);
      const done = await qaReset(jsonRequest({ confirm: true, reason: "Wrong inspection recorded", appliedStockCounts: "KEEP" }), { params: { id: jobId } });
      expect(done.status).toBe(200);
      expect((await m.client.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("QA_REVIEW");
      expect(await onHand(soapId)).toBe(3);
    });
  });
});
