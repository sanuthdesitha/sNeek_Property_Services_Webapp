// @vitest-environment node
/**
 * Wave F on a real PostgreSQL database (SNEEK_TEST_DATABASE_URL, loopback 55439):
 *  - "Add to shopping run": a planned line on an open run, the need linked,
 *    stage unchanged, idempotent per request, refused on a closed run, a new
 *    run rolled back when nothing could be added;
 *  - "Ask cleaner to buy": ASKED -> ACCEPTED (on the cleaner's own run) /
 *    DECLINED / WITHDRAWN, one live ask, "Bought" only after the run is
 *    submitted and the reimbursement approved;
 *  - operations managers by their inventory pack (read / manage / off);
 *  - the job on a need (cleaner report, form submission, refused job);
 *  - stock count observations applied on approval only, never twice, never
 *    over a newer stock movement, superseded by a newer submission;
 *  - laundry planned times.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", cleanerPortalVisibility: { showShopping: true } }) }));

import { reportUrgentStock, reportUrgentStockFromSubmission, actOnUrgentStock } from "@/lib/inventory/urgent-stock";
import { listUrgentNeedsForOffice } from "@/lib/inventory/urgent-stock-list";
import { addUrgentNeedsToShoppingRun } from "@/lib/inventory/urgent-stock-shopping";
import { answerPurchaseAsk, createPurchaseAsk, withdrawPurchaseAsk } from "@/lib/inventory/urgent-stock-ask";
import { needLinksFor } from "@/lib/inventory/urgent-stock-list-links";
import { recordStockCountObservations } from "@/lib/inventory/stock-count-observations";
import { applyJobRotationCompletion } from "@/lib/accountability/rotation";
import { setLaundryPlannedTimes } from "@/lib/laundry/planned-times";
import { parseListQuery } from "@/lib/admin/list-query";
import { URGENT_SORTS } from "@/lib/inventory/urgent-stock-actions";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const id = (name: string) => `wf-${tag}-${name}`;
const admin = { id: id("admin"), role: Role.ADMIN };
const ops = { id: id("ops"), role: Role.OPS_MANAGER };
const cleaner = { id: id("cleaner"), role: Role.CLEANER };
const otherCleaner = { id: id("cleaner2"), role: Role.CLEANER };
const propertyId = id("property");
const otherPropertyId = id("property2");
const itemId = id("item");
const unstockedItemId = id("item2");
const jobId = id("job");
const OPS_KEY = "ops_feature_permissions_v1";

function need(extra: Record<string, unknown> = {}) {
  return { propertyId, itemId, requestId: randomUUID(), observedCount: null, observedAt: null, purchaseQuantity: 6, note: "Fixture need", ...extra };
}
async function openNeed() {
  return reportUrgentStock(admin, need());
}
async function setOps(levels: Record<string, string> | null) {
  if (!levels) {
    await m.client.appSetting.deleteMany({ where: { key: OPS_KEY } });
    return;
  }
  const value = { revision: 1, presets: [], assignments: { [ops.id]: { presetId: "existing", overrides: levels } } };
  await m.client.appSetting.upsert({ where: { key: OPS_KEY }, create: { key: OPS_KEY, value }, update: { value } });
}

describe.skipIf(!url)("Wave F stock, cases and laundry on PostgreSQL", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [admin, ops, cleaner, otherCleaner].map((user) => ({ id: user.id, email: `${user.id}@example.invalid`, name: user.id, role: user.role })) });
    await m.client.client.create({ data: { id: id("client"), name: "Wave F client" } });
    await m.client.property.createMany({ data: [propertyId, otherPropertyId].map((pid) => ({ id: pid, name: pid, clientId: id("client"), address: "1 Fixture St", suburb: "Fixture", inventoryEnabled: true })) });
    await m.client.inventoryItem.createMany({ data: [{ id: itemId, name: "Fixture soap", category: "Fixture", unit: "bottle" }, { id: unstockedItemId, name: "Fixture pods", category: "Fixture" }] });
    await m.client.propertyStock.create({ data: { propertyId, itemId, onHand: 10, parLevel: 8 } });
    await m.client.job.create({ data: { id: jobId, jobNumber: id("J"), propertyId, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date(Date.now() + 86_400_000), startTime: "10:00", assignments: { create: { userId: cleaner.id, responseStatus: "ACCEPTED" } } } });
  });
  beforeEach(async () => {
    await m.client.urgentStockPurchaseAsk.deleteMany({ where: { need: { propertyId } } });
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId } });
    await m.client.shoppingRun.deleteMany({ where: { ownerUserId: { in: [admin.id, cleaner.id, ops.id] } } });
    await m.client.stockCountObservation.deleteMany({ where: { propertyId } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
    await m.client.formSubmission.deleteMany({ where: { jobId } });
    await m.client.propertyStock.updateMany({ where: { propertyId }, data: { onHand: 10 } });
    await m.client.job.update({ where: { id: jobId }, data: { status: "ASSIGNED" } });
    await setOps(null);
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.urgentStockPurchaseAsk.deleteMany({ where: { need: { propertyId } } });
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId: { in: [propertyId, otherPropertyId] } } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId: { in: [propertyId, otherPropertyId] } } });
    await m.client.shoppingRun.deleteMany({ where: { ownerUserId: { in: [admin.id, cleaner.id, ops.id] } } });
    await m.client.stockCountObservation.deleteMany({ where: { propertyId } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
    await m.client.formSubmission.deleteMany({ where: { jobId } });
    await m.client.laundryTask.deleteMany({ where: { jobId } });
    await m.client.jobAssignment.deleteMany({ where: { jobId } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: [admin.id, ops.id, cleaner.id] } } });
    await m.client.job.deleteMany({ where: { id: jobId } });
    await m.client.propertyStock.deleteMany({ where: { propertyId } });
    await m.client.inventoryItem.deleteMany({ where: { id: { in: [itemId, unstockedItemId] } } });
    await m.client.formTemplate.deleteMany({ where: { id: id("template") } });
    await m.client.property.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.appSetting.deleteMany({ where: { key: { in: [OPS_KEY] } } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: [admin.id, ops.id, cleaner.id, otherCleaner.id] } } });
    await m.client.user.deleteMany({ where: { id: { in: [admin.id, ops.id, cleaner.id, otherCleaner.id] } } });
    await m.client.$disconnect();
  });

  it("adds a need to an open run as a planned line, links it, keeps the stage, and is idempotent", async () => {
    const reported = await openNeed();
    const run = await m.client.shoppingRun.create({ data: { ownerUserId: admin.id, title: "Thursday shop", status: "DRAFT" } });
    const body = { requestId: randomUUID(), needIds: [reported.id], target: { kind: "existing", runId: run.id } };
    const first = await addUrgentNeedsToShoppingRun(admin, body);
    expect(first.results).toEqual([expect.objectContaining({ id: reported.id, outcome: "done" })]);
    expect(await addUrgentNeedsToShoppingRun(admin, body)).toEqual(first);
    const again = await addUrgentNeedsToShoppingRun(admin, { ...body, requestId: randomUUID() });
    expect(again.results[0].outcome).toBe("already");
    const lines = await m.client.shoppingRunLine.findMany({ where: { shoppingRunId: run.id } });
    expect(lines).toEqual([expect.objectContaining({ propertyId, itemId, plannedQty: 6, purchasedQty: 0, status: "PLANNED" })]);
    const stored = await m.client.urgentStockNeed.findUniqueOrThrow({ where: { id: reported.id } });
    expect(stored).toMatchObject({ shoppingRunId: run.id, stage: "REPORTED", shoppingRunAddedById: admin.id });
    const links = (await needLinksFor([reported.id])).get(reported.id)!;
    expect(links.shoppingRun).toMatchObject({ title: "Thursday shop", open: true, line: { plannedQty: 6, purchased: false } });
  });

  it("refuses a closed run with the reason and rolls back a new run when nothing could be added", async () => {
    const reported = await openNeed();
    const closed = await m.client.shoppingRun.create({ data: { ownerUserId: admin.id, title: "Done shop", status: "SUBMITTED", submittedAt: new Date() } });
    await expect(addUrgentNeedsToShoppingRun(admin, { requestId: randomUUID(), needIds: [reported.id], target: { kind: "existing", runId: closed.id } })).rejects.toThrow(/closed/);
    await actOnUrgentStock(admin, { reportId: reported.id, requestId: randomUUID(), expectedVersion: reported.version, stage: "ADMIN_RESOLVED", reason: "Not needed", observedCount: null, observedAt: null, needResolved: false });
    await expect(addUrgentNeedsToShoppingRun(admin, { requestId: randomUUID(), needIds: [reported.id], target: { kind: "new", title: "Empty" } })).rejects.toThrow(/Nothing was added/);
    expect(await m.client.shoppingRun.count({ where: { title: "Empty", ownerUserId: admin.id } })).toBe(0);
  });

  it("asks a cleaner, who accepts onto their own run; Bought shows only after submission and office approval", async () => {
    const reported = await openNeed();
    const ask = await createPurchaseAsk(admin, { needId: reported.id, requestKey: randomUUID(), cleanerId: cleaner.id, jobId, quantity: null, note: null, transports: ["INBOX"] });
    expect(ask).toMatchObject({ cleanerId: cleaner.id, quantity: 6, created: true });
    await expect(createPurchaseAsk(admin, { needId: reported.id, requestKey: randomUUID(), cleanerId: otherCleaner.id, jobId: null, quantity: 2, note: null, transports: ["INBOX"] })).rejects.toThrow(/already asked/);
    await expect(answerPurchaseAsk(otherCleaner, ask.id, { decision: "accept", note: null })).rejects.toThrow("NOT_FOUND");
    expect((await needLinksFor([reported.id])).get(reported.id)!.purchaseAsk?.state).toBe("ASKED");
    const accepted = await answerPurchaseAsk(cleaner, ask.id, { decision: "accept", note: null });
    expect(accepted.state).toBe("ACCEPTED");
    const run = await m.client.shoppingRun.findUniqueOrThrow({ where: { id: accepted.runId! }, include: { lines: true } });
    expect(run.ownerUserId).toBe(cleaner.id);
    expect(run.lines).toEqual([expect.objectContaining({ itemId, plannedQty: 6, status: "PLANNED" })]);
    expect((await m.client.urgentStockNeed.findUniqueOrThrow({ where: { id: reported.id } })).stage).toBe("REPORTED");
    // Bought on the run but not yet approved by the office.
    await m.client.shoppingRunLine.updateMany({ where: { shoppingRunId: run.id }, data: { purchasedQty: 6, status: "PURCHASED" } });
    await m.client.shoppingRun.update({ where: { id: run.id }, data: { status: "SUBMITTED", submittedAt: new Date(), settlements: { create: { paymentMethod: "CLEANER_CARD", paidByScope: "CLEANER", adminApprovedForCleanerReimbursement: false } } } });
    expect((await needLinksFor([reported.id])).get(reported.id)!.purchaseAsk?.state).toBe("BOUGHT_AWAITING_APPROVAL");
    await m.client.shoppingSettlement.updateMany({ where: { shoppingRunId: run.id }, data: { adminApprovedForCleanerReimbursement: true } });
    expect((await needLinksFor([reported.id])).get(reported.id)!.purchaseAsk?.state).toBe("BOUGHT");
  });

  it("records a decline and a withdrawal, each freeing the need for a new ask", async () => {
    const reported = await openNeed();
    const first = await createPurchaseAsk(admin, { needId: reported.id, requestKey: randomUUID(), cleanerId: cleaner.id, jobId: null, quantity: 3, note: "Woolies is fine", transports: ["INBOX"] });
    await answerPurchaseAsk(cleaner, first.id, { decision: "decline", note: "No car today" });
    const second = await createPurchaseAsk(admin, { needId: reported.id, requestKey: randomUUID(), cleanerId: otherCleaner.id, jobId: null, quantity: 3, note: null, transports: ["INBOX"] });
    await withdrawPurchaseAsk(admin, second.id, "Bought it ourselves");
    await expect(answerPurchaseAsk(otherCleaner, second.id, { decision: "accept", note: null })).rejects.toThrow(/withdrawn/);
    const states = await m.client.urgentStockPurchaseAsk.findMany({ where: { needId: reported.id }, orderBy: { createdAt: "asc" }, select: { state: true, activeKey: true, responseNote: true } });
    expect(states).toEqual([{ state: "DECLINED", activeKey: null, responseNote: "No car today" }, { state: "WITHDRAWN", activeKey: null, responseNote: "Bought it ourselves" }]);
  });

  it("lets an operations manager act with the inventory pack: read sees, manage acts, off is refused; resolving stays ADMIN-only", async () => {
    const reported = await openNeed();
    const query = parseListQuery(new URLSearchParams(), { sortable: URGENT_SORTS, defaultSort: "neededBy", defaultDir: "asc", defaultPageSize: 25, maxPageSize: 100 });
    await setOps({ inventory: "off" });
    await expect(listUrgentNeedsForOffice(ops, { filter: "open", q: "", propertyId }, query)).rejects.toThrow("FORBIDDEN");
    await setOps({ inventory: "read" });
    expect((await listUrgentNeedsForOffice(ops, { filter: "open", q: "", propertyId }, query)).rows.map((row) => row.id)).toEqual([reported.id]);
    await expect(actOnUrgentStock(ops, { reportId: reported.id, requestId: randomUUID(), expectedVersion: reported.version, stage: "ACKNOWLEDGED", reason: "Seen", observedCount: null, observedAt: null, needResolved: false })).rejects.toThrow("FORBIDDEN");
    await setOps({ inventory: "manage" });
    const acknowledged = await actOnUrgentStock(ops, { reportId: reported.id, requestId: randomUUID(), expectedVersion: reported.version, stage: "ACKNOWLEDGED", reason: "Seen", observedCount: null, observedAt: null, needResolved: false });
    expect(acknowledged.stage).toBe("ACKNOWLEDGED");
    await expect(actOnUrgentStock(ops, { reportId: reported.id, requestId: randomUUID(), expectedVersion: acknowledged.version, stage: "ADMIN_RESOLVED", reason: "Close", observedCount: null, observedAt: null, needResolved: false })).rejects.toThrow(/Only an administrator/);
  });

  it("stores the job a need was reported from, refuses another property's job, and defers a form's count to approval", async () => {
    const reported = await reportUrgentStock(cleaner, need({ jobId }));
    expect((await m.client.urgentStockNeed.findUniqueOrThrow({ where: { id: reported.id } })).sourceJobId).toBe(jobId);
    await expect(reportUrgentStock(cleaner, need({ itemId: unstockedItemId, jobId: id("nope") }))).rejects.toThrow(/not at this property/);
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId } });
    await m.client.formTemplate.upsert({ where: { id: id("template") }, create: { id: id("template"), name: "Wave F", serviceType: "AIRBNB_TURNOVER", schema: {} }, update: {} });
    const submission = await m.client.formSubmission.create({ data: { jobId, templateId: id("template"), submittedById: cleaner.id, data: {} } });
    const raised = await reportUrgentStockFromSubmission({ cleanerId: cleaner.id, submissionId: submission.id, report: need({ observedCount: 1, observedAt: new Date().toISOString(), purchaseQuantity: null }) });
    expect(raised.observationDisposition).toBe("PENDING_APPROVAL");
    expect((await m.client.urgentStockNeed.findUniqueOrThrow({ where: { id: raised.id } })).sourceSubmissionId).toBe(submission.id);
    expect((await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId } })).onHand).toBe(10);
  });

  it("applies a form's stock count to on-hand on approval only, once, and reports an unknown item for review", async () => {
    await m.client.formTemplate.upsert({ where: { id: id("template") }, create: { id: id("template"), name: "Wave F", serviceType: "AIRBNB_TURNOVER", schema: {} }, update: {} });
    const submission = await m.client.formSubmission.create({ data: { jobId, templateId: id("template"), submittedById: cleaner.id, data: {} } });
    await m.client.job.update({ where: { id: jobId }, data: { status: "SUBMITTED" } });
    const counts = [
      { fieldId: "soap", label: "Soap left", itemId, itemName: "Soap", unit: "bottle", count: 3 },
      { fieldId: "pods", label: "Pods left", itemId: unstockedItemId, itemName: "Pods", unit: null, count: 1 },
    ];
    const recorded = await m.client.$transaction((tx) => recordStockCountObservations(tx, { submissionId: submission.id, jobId, propertyId, observedAt: submission.createdAt, counts }));
    expect(recorded).toEqual({ recorded: 2, needsReview: 1 });
    // Pending approval: nothing changes, even when the approval hook runs early.
    await m.client.$transaction((tx) => applyJobRotationCompletion(tx, { jobId, propertyId }));
    expect((await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId } })).onHand).toBe(10);
    await m.client.job.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
    await m.client.$transaction((tx) => applyJobRotationCompletion(tx, { jobId, propertyId }));
    await m.client.$transaction((tx) => applyJobRotationCompletion(tx, { jobId, propertyId }));
    const stock = await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId } });
    expect(stock.onHand).toBe(3);
    const ledger = await m.client.stockTx.findMany({ where: { propertyStockId: stock.id } });
    expect(ledger).toEqual([expect.objectContaining({ submissionId: submission.id, txType: "ADJUSTED", quantity: -7 })]);
    const rows = await m.client.stockCountObservation.findMany({ where: { submissionId: submission.id }, orderBy: { itemId: "asc" } });
    expect(rows.map((row) => [row.itemId, row.status])).toEqual([[itemId, "APPLIED"], [unstockedItemId, "NEEDS_REVIEW"]]);
    expect(rows[0].previousOnHand).toBe(10);
  });

  it("never overwrites a newer stock movement, and a newer submission supersedes a pending count", async () => {
    await m.client.formTemplate.upsert({ where: { id: id("template") }, create: { id: id("template"), name: "Wave F", serviceType: "AIRBNB_TURNOVER", schema: {} }, update: {} });
    const first = await m.client.formSubmission.create({ data: { jobId, templateId: id("template"), submittedById: cleaner.id, data: {}, createdAt: new Date(Date.now() - 120_000) } });
    const count = [{ fieldId: "soap", label: "Soap left", itemId, itemName: "Soap", unit: "bottle", count: 2 }];
    await m.client.$transaction((tx) => recordStockCountObservations(tx, { submissionId: first.id, jobId, propertyId, observedAt: first.createdAt, counts: count }));
    const second = await m.client.formSubmission.create({ data: { jobId, templateId: id("template"), submittedById: cleaner.id, data: {}, createdAt: new Date(Date.now() - 60_000) } });
    await m.client.$transaction((tx) => recordStockCountObservations(tx, { submissionId: second.id, jobId, propertyId, observedAt: second.createdAt, counts: [{ ...count[0], count: 4 }] }));
    expect((await m.client.stockCountObservation.findFirstOrThrow({ where: { submissionId: first.id } })).status).toBe("SUPERSEDED");
    // An office count after the clean's count.
    const stock = await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId } });
    await m.client.stockTx.create({ data: { propertyStockId: stock.id, txType: "ADJUSTED", quantity: 1, notes: "Office count" } });
    await m.client.job.update({ where: { id: jobId }, data: { status: "COMPLETED" } });
    await m.client.$transaction((tx) => applyJobRotationCompletion(tx, { jobId, propertyId }));
    expect((await m.client.propertyStock.findFirstOrThrow({ where: { propertyId, itemId } })).onHand).toBe(10);
    expect((await m.client.stockCountObservation.findFirstOrThrow({ where: { submissionId: second.id } })).status).toBe("SKIPPED_NEWER");
  });

  it("stores laundry planned times, clears them to null, refuses a bad time and a stale write", async () => {
    const task = await m.client.laundryTask.upsert({ where: { jobId }, create: { jobId, propertyId, pickupDate: new Date(), dropoffDate: new Date() }, update: { pickupTime: null, dropoffTime: null } });
    const saved = await setLaundryPlannedTimes(admin.id, task.id, { pickupTime: "15:00", dropoffTime: null, expectedUpdatedAt: task.updatedAt.toISOString() });
    expect(saved).toMatchObject({ pickupTime: "15:00", dropoffTime: null });
    await expect(setLaundryPlannedTimes(admin.id, task.id, { pickupTime: "25:00", dropoffTime: null })).rejects.toThrow(/24-hour/);
    await expect(setLaundryPlannedTimes(admin.id, task.id, { pickupTime: null, dropoffTime: "09:30", expectedUpdatedAt: task.updatedAt.toISOString() })).rejects.toThrow(/changed since/);
    await expect(m.client.$executeRawUnsafe(`UPDATE "LaundryTask" SET "pickupTime" = '9am' WHERE id = '${task.id}'`)).rejects.toThrow();
    const cleared = await setLaundryPlannedTimes(admin.id, task.id, { pickupTime: null, dropoffTime: null });
    expect(cleared).toMatchObject({ pickupTime: null, dropoffTime: null });
  });
});
