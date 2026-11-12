// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { reportUrgentStock as report, actOnUrgentStock as act, listUrgentStock as list, setUrgentStockSettings as settings, dispatchUrgentStockReminders as reminders, nextUrgentStockClean } from "@/lib/inventory/urgent-stock";
import { formatInTimeZone } from "date-fns-tz";
import { countUrgentNeedsAwaitingAcknowledgement, listUrgentNeedsForOffice } from "@/lib/inventory/urgent-stock-list";
import { runUrgentStockBulk } from "@/lib/inventory/urgent-stock-bulk";
import { parseListQuery } from "@/lib/admin/list-query";
import { URGENT_SORTS } from "@/lib/inventory/urgent-stock-actions";
const url = process.env.SNEEK_TEST_DATABASE_URL;
const prefix = "urgent_stock_v1:";
const ids = Array.from({ length: 7 }, () => randomUUID());
const [adminId, cleanerId, strangerId, clientId, propertyId, itemId, jobId] = ids;
const admin = { id: adminId, role: Role.ADMIN }, cleaner = { id: cleanerId, role: Role.CLEANER }, stranger = { id: strangerId, role: Role.CLEANER };
const input = () => ({ propertyId, itemId, requestId: randomUUID(), observedCount: null as number | null, observedAt: null as string | null, purchaseQuantity: null as number | null, note: "Paper needed, actual quantity unknown" });
const action = (need: any, stage: string, extra = {}) => ({ reportId: need.id, requestId: randomUUID(), expectedVersion: need.version, stage, reason: "Recorded by fixture", observedCount: null, observedAt: null, needResolved: false, ...extra });
describe.skipIf(!url)("urgent stock transactional integration", () => {
 beforeAll(async () => {
  if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
  m.client = new PrismaClient({ datasources: { db: { url } } });
  await m.client.user.createMany({ data: [admin, cleaner, stranger].map(user => ({ id: user.id, email: `${user.id}@example.invalid`, role: user.role })) });
  await m.client.client.create({ data: { id: clientId, name: "Stock fixture client" } });
  await m.client.property.create({ data: { id: propertyId, name: "Stock fixture property", clientId, address: "Fixture", suburb: "Fixture", inventoryEnabled: true } });
  await m.client.inventoryItem.create({ data: { id: itemId, name: "Fixture paper", category: "Fixture" } });
  await m.client.propertyStock.create({ data: { propertyId, itemId, onHand: 10 } });
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: new Date(), assignments: { create: { userId: cleaner.id, responseStatus: "ACCEPTED" } } } });
 });
 beforeEach(async () => {
  await m.client.urgentStockEvent.deleteMany({ where: { propertyId } }); await m.client.urgentStockNeed.deleteMany({ where: { propertyId } });
  await m.client.appSetting.deleteMany({ where: { key: { startsWith: prefix } } });
  await m.client.notificationIntent.deleteMany({ where: { recipientId: adminId } });
  await m.client.notification.deleteMany({ where: { userId: adminId } });
  await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
  await m.client.propertyStock.updateMany({ where: { propertyId }, data: { onHand: 10, updatedAt: new Date(Date.now() - 3600000) } });
  await m.client.jobAssignment.updateMany({ where: { jobId }, data: { removedAt: null } });
  await m.client.job.update({ where: { id: jobId }, data: { status: "ASSIGNED", cleanSkipStatus: "NONE", scheduledDate: new Date(), startTime: "12:00" } });
 });
 afterAll(async () => {
  await m.client.urgentStockEvent.deleteMany({ where: { propertyId } }); await m.client.urgentStockNeed.deleteMany({ where: { propertyId } });
  await m.client.appSetting.deleteMany({ where: { key: { startsWith: prefix } } });
  await m.client.notificationIntent.deleteMany({ where: { recipientId: adminId } });
  await m.client.notification.deleteMany({ where: { userId: { in: [adminId, cleanerId, strangerId] } } });
  await m.client.auditLog.deleteMany({ where: { userId: adminId } });
  await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
  await m.client.propertyStock.deleteMany({ where: { propertyId } });
  await m.client.jobAssignment.deleteMany({ where: { jobId } }); await m.client.job.delete({ where: { id: jobId } });
  await m.client.property.delete({ where: { id: propertyId } }); await m.client.client.delete({ where: { id: clientId } });
  await m.client.inventoryItem.delete({ where: { id: itemId } }); await m.client.user.deleteMany({ where: { id: { in: [adminId, cleanerId, strangerId] } } }); await m.client.$disconnect();
 });
 it("keeps unknowns unknown; concurrent reports deduplicate and retries preserve history once", async () => {
  const request = input();
  const [a, b] = await Promise.all([report(cleaner, request), report(cleaner, request)]);
  expect(a.id).toBe(b.id); expect(a.observedCount).toBeNull(); expect(a.purchaseQuantity).toBeNull();
  const others = await Promise.all([report(admin, input()), report(cleaner, input())]);
  expect(others.every(row => row.id === a.id)).toBe(true);
  // Needs and history now live in tables (same one-open-need and append-only rules).
  expect(await m.client.urgentStockNeed.count({ where: { propertyId, openPairKey: { not: null } } })).toBe(1);
  expect(await m.client.urgentStockEvent.count({ where: { propertyId } })).toBe(3);
  expect(await m.client.appSetting.count({ where: { key: { startsWith: prefix + "need:" } } })).toBe(0);
  expect((await m.client.propertyStock.findFirst({ where: { propertyId } })).onHand).toBe(10);
  expect(await m.client.stockTx.count({ where: { propertyStock: { propertyId } } })).toBe(0);
  await expect(report(cleaner, { ...request, note: "Changed retry" })).rejects.toThrow("CONFLICT");
 });
 it("applies only fresh observations under the stock row lock and reconciles ledger delta", async () => {
  const first = await report(cleaner, { ...input(), observedCount: 0, observedAt: new Date(Date.now() - 1000).toISOString(), purchaseQuantity: 12 });
  expect(first.observationDisposition).toBe("APPLY");
  expect((await m.client.stockTx.findFirst({ where: { propertyStock: { propertyId } } })).quantity).toBe(-10);
  for (const observedAt of [new Date(Date.now() - 7200000), new Date(Date.now() + 7200000)]) await report(cleaner, { ...input(), observedCount: 99, observedAt: observedAt.toISOString() });
  expect((await m.client.propertyStock.findFirst({ where: { propertyId } })).onHand).toBe(0);
  expect(await m.client.stockTx.count({ where: { propertyStock: { propertyId } } })).toBe(1);
 });
 it("checks current assignment and role for reads, reports, transitions and settings", async () => {
  const need = await report(cleaner, input());
  await expect(list(stranger, propertyId)).rejects.toThrow("FORBIDDEN");
  await expect(report(stranger, input())).rejects.toThrow("FORBIDDEN");
  await expect(report({ ...stranger, role: Role.ADMIN }, input())).rejects.toThrow("FORBIDDEN");
  await expect(act(cleaner, action(need, "ADMIN_RESOLVED"))).rejects.toThrow("Only an administrator");
  await expect(settings(cleaner, { enabled: true, intervalHours: 1, maxReminders: 1, beforeNextCleanHours: 1 })).rejects.toThrow("FORBIDDEN");
  await m.client.jobAssignment.updateMany({ where: { jobId }, data: { removedAt: new Date() } });
  await expect(act(cleaner, action(need, "ACKNOWLEDGED"))).rejects.toThrow("FORBIDDEN");
  await expect(list(cleaner, propertyId)).rejects.toThrow("FORBIDDEN");
 });
 it("waits for concurrent stock writes and never overwrites them with an older observation", async () => {
  let release!: () => void, locked!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writer = m.client.$transaction(async (tx: any) => {
   await tx.$queryRaw`SELECT "id" FROM "PropertyStock" WHERE "propertyId" = ${propertyId} AND "itemId" = ${itemId} FOR UPDATE`;
   locked(); await gate;
   await tx.propertyStock.updateMany({ where: { propertyId, itemId }, data: { onHand: 17, updatedAt: new Date() } });
  });
  await acquired;
  const pending = report(cleaner, { ...input(), observedCount: 1, observedAt: new Date(Date.now() - 1000).toISOString() });
  release(); await writer;
  expect((await pending).observationDisposition).toBe("STALE");
  expect((await m.client.propertyStock.findFirst({ where: { propertyId } })).onHand).toBe(17);
 });
 it("keeps ordered/delivered open, rejects stale versions and rolls back invalid confirmation", async () => {
  let need = await report(cleaner, input()); const initial = need;
  for (const stage of ["ACKNOWLEDGED", "ORDERED", "DELIVERED"]) { need = await act(cleaner, action(need, stage)); expect(await m.client.urgentStockNeed.count({ where: { propertyId, openPairKey: { not: null } } })).toBe(1); }
  await expect(act(admin, action(initial, "ADMIN_RESOLVED"))).rejects.toThrow("CONFLICT");
  await expect(act(cleaner, action(need, "PROPERTY_CONFIRMED", { observedCount: 2, observedAt: new Date().toISOString(), needResolved: false }))).rejects.toThrow("Confirm a fresh");
  expect((await m.client.propertyStock.findFirst({ where: { propertyId } })).onHand).toBe(10);
  expect(await m.client.stockTx.count({ where: { propertyStock: { propertyId } } })).toBe(0);
  const closed = await act(cleaner, action(need, "PROPERTY_CONFIRMED", { observedCount: 12, observedAt: new Date().toISOString(), needResolved: true }));
  expect(closed.stage).toBe("PROPERTY_CONFIRMED"); expect(await m.client.urgentStockNeed.count({ where: { propertyId, openPairKey: { not: null } } })).toBe(0);
  const newNeed = await report(cleaner, input()); expect(newNeed.id).not.toBe(closed.id);
  expect((await list(admin, propertyId, closed.id)).events).toHaveLength(5);
 });
 it("serializes duplicate reminder workers, bounds reminders and stops after justified resolution", async () => {
  const need = await report(cleaner, input());
  await settings(admin, { enabled: true, intervalHours: 24, maxReminders: 1, beforeNextCleanHours: 24 });
  const now = new Date(Date.now() + 3600001);
  const results = await Promise.all([reminders(now), reminders(now)]);
  expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
  const intents = await m.client.notificationIntent.findMany({ where: { recipientId: adminId } });
  expect(intents).toHaveLength(2);
  expect(intents.every((row: any) => row.transport === "INBOX" && row.status === "QUEUED")).toBe(true);
  expect(intents.map((row: any) => row.envelope.category)).toEqual(["shopping", "shopping"]);
  expect(await m.client.notification.count({ where: { userId: adminId } })).toBe(0);
  expect((await reminders(new Date(now.getTime() + 86400000))).sent).toBe(0);
  await act(admin, action(need, "ADMIN_RESOLVED"));
  expect((await reminders(new Date(now.getTime() + 172800000))).sent).toBe(0);
 });
 it("recalculates deadlines and excludes skipped or completed work", async () => {
  await m.client.job.update({ where: { id: jobId }, data: { scheduledDate: new Date("2030-01-03T00:00:00Z"), startTime: "10:30" } });
  expect((await nextUrgentStockClean(m.client, propertyId, new Date("2030-01-01"), "Australia/Sydney"))?.toISOString()).toBe("2030-01-02T23:30:00.000Z");
  await m.client.job.update({ where: { id: jobId }, data: { cleanSkipStatus: "SKIPPED" } });
  expect(await nextUrgentStockClean(m.client, propertyId, new Date("2030-01-01"), "Australia/Sydney")).toBeNull();
 });
});

// Office list, bulk and table parity. In this file (not its own) so it runs
// after the reminder test above rather than beside it: the reminder worker
// reads every open need in the database.
{
const [officeAdminId, officeCleanerId, officeClientId, soonId, laterId, noCleanId, officeItemId] = Array.from({ length: 7 }, () => randomUUID());
const officeAdmin = { id: officeAdminId, role: Role.ADMIN }, officeCleaner = { id: officeCleanerId, role: Role.CLEANER };
const propertyIds = [soonId, laterId, noCleanId];
const officeQuery = (search = "") => parseListQuery(new URLSearchParams(search), { sortable: URGENT_SORTS, defaultSort: "neededBy", defaultDir: "asc" });
const officeReport = (propertyId: string, note = "Needed") => report(officeAdmin, { propertyId, itemId: officeItemId, requestId: randomUUID(), observedCount: null, observedAt: null, purchaseQuantity: 4, note });
const step = (need: any, stage: string) => act(officeAdmin, { reportId: need.id, requestId: randomUUID(), expectedVersion: need.version, stage, reason: "Fixture", observedCount: null, observedAt: null, needResolved: false });

describe.skipIf(!url)("urgent stock office list, bulk and table parity (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [{ id: officeAdminId, email: `${officeAdminId}@example.invalid`, role: Role.ADMIN, name: "Office" }, { id: officeCleanerId, email: `${officeCleanerId}@example.invalid`, role: Role.CLEANER }] });
    await m.client.client.create({ data: { id: officeClientId, name: "Urgent fixture client" } });
    await m.client.property.createMany({ data: propertyIds.map((id, index) => ({ id, name: `Urgent ${["A soon", "B later", "C none"][index]}`, clientId: officeClientId, address: "x", suburb: "y", inventoryEnabled: true })) });
    await m.client.inventoryItem.create({ data: { id: officeItemId, name: "Fixture soap", category: "Fixture", unit: "bottle" } });
    await m.client.propertyStock.createMany({ data: propertyIds.map((propertyId) => ({ propertyId, itemId: officeItemId, onHand: 1, parLevel: propertyId === soonId ? 6 : 0 })) });
    // A clean whose Sydney start is `hours` from now (job dates are Sydney calendar days).
    const cleanIn = (hours: number) => {
      const at = new Date(Date.now() + hours * 3_600_000);
      return { scheduledDate: new Date(`${formatInTimeZone(at, "Australia/Sydney", "yyyy-MM-dd")}T00:00:00Z`), startTime: formatInTimeZone(at, "Australia/Sydney", "HH:mm") };
    };
    await m.client.job.createMany({ data: [
      { id: randomUUID(), jobNumber: randomUUID(), propertyId: soonId, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", ...cleanIn(24) },
      { id: randomUUID(), jobNumber: randomUUID(), propertyId: laterId, jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", ...cleanIn(120) },
    ] });
  });
  beforeEach(async () => {
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: officeAdminId } });
  });
  afterAll(async () => {
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: officeAdminId } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "urgent_stock_v1:receipt:" } } });
    await m.client.auditLog.deleteMany({ where: { userId: officeAdminId } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId: { in: propertyIds } } } });
    await m.client.propertyStock.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.job.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.property.deleteMany({ where: { id: { in: propertyIds } } });
    await m.client.client.delete({ where: { id: officeClientId } });
    await m.client.inventoryItem.delete({ where: { id: officeItemId } });
    await m.client.user.deleteMany({ where: { id: { in: [officeAdminId, officeCleanerId] } } });
    await m.client.$disconnect();
  });

  it("returns a migrated row exactly as its JSON was stored (same keys, values and ISO strings)", async () => {
    const stored = { id: randomUUID(), propertyId: soonId, itemId: officeItemId, propertyName: "Urgent A soon", itemName: "Fixture soap", unit: "bottle", stage: "ACKNOWLEDGED", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T03:04:05.678Z", version: 2, observedCount: 0, purchaseQuantity: 12.5, observedAt: "2026-11-01T10:00:00+11:00", observationDisposition: "APPLY", note: "Out of soap", lastReminderAt: null, remindersSent: 0 };
    await m.client.urgentStockNeed.create({ data: { ...stored, createdAt: new Date(stored.createdAt), updatedAt: new Date(stored.updatedAt), openPairKey: `urgent_stock_v1:open:${randomUUID()}` } });
    const event = { reportId: stored.id, propertyId: soonId, actorId: null, actorName: "Reminder worker", kind: "REMINDER", at: "2026-11-02T03:04:05.678Z", detail: { nextCleanAt: null, number: 1 } };
    await m.client.urgentStockEvent.create({ data: { id: randomUUID(), needId: stored.id, propertyId: soonId, actorId: null, actorName: event.actorName, kind: event.kind, detail: event.detail, at: new Date(event.at) } });
    const result = await list(officeAdmin, soonId, stored.id);
    // Same keys and values (the old JSONB store did not keep key order either).
    expect(result.reports[0]).toStrictEqual(stored);
    expect(result.events[0]).toStrictEqual(event);
    expect(Object.keys(result)).toEqual(["properties", "items", "reports", "events", "nextCleanAt", "settings"]);
  });

  it("lists every property sorted by the next clean that needs the item; unknown last; closed has none", async () => {
    const later = await officeReport(laterId), soon = await officeReport(soonId), none = await officeReport(noCleanId);
    // Scoped by name: other database suites may hold needs at the same time.
    const ordered = await listUrgentNeedsForOffice(officeAdmin, { filter: "open", q: "Urgent ", propertyId: null }, officeQuery());
    expect(ordered.rows.map((row) => row.propertyId)).toEqual([soonId, laterId, noCleanId]);
    expect(ordered.rows.map((row) => row.neededByState)).toEqual(["upcoming", "upcoming", "unknown"]);
    expect(ordered.rows[0]).toMatchObject({ parLevel: 6, suggestedBuy: null, purchaseQuantity: 4, reportedByName: "Office" });
    expect(ordered.rows[2]).toMatchObject({ parLevel: null, neededBy: null });
    // The summary is deliberately unfiltered (the header), so other suites' needs may add to it.
    expect(ordered.summary.open).toBeGreaterThanOrEqual(3);
    expect(ordered.summary.properties).toBeGreaterThanOrEqual(3);
    expect(ordered.summary.dueSoon).toBeGreaterThanOrEqual(1);
    expect(ordered.counts).toMatchObject({ open: 3, REPORTED: 3, closed: 0, all: 3 });
    const reversed = await listUrgentNeedsForOffice(officeAdmin, { filter: "open", q: "Urgent ", propertyId: null }, officeQuery("sort=neededBy&dir=desc"));
    expect(reversed.rows.map((row) => row.propertyId)).toEqual([laterId, soonId, noCleanId]);
    await step(none, "ADMIN_RESOLVED");
    const closed = await listUrgentNeedsForOffice(officeAdmin, { filter: "closed", q: "Urgent ", propertyId: null }, officeQuery());
    expect(closed.rows).toHaveLength(1);
    expect(closed.rows[0]).toMatchObject({ id: none.id, neededBy: null, neededByState: "closed" });
    const paged = await listUrgentNeedsForOffice(officeAdmin, { filter: "all", q: "urgent b", propertyId: null }, officeQuery("pageSize=1"));
    expect(paged).toMatchObject({ total: 1, pageCount: 1 });
    expect(paged.rows[0].id).toBe(later.id);
    expect(soon.id).not.toBe(later.id);
    expect(await countUrgentNeedsAwaitingAcknowledgement()).toBeGreaterThanOrEqual(2);
    expect(await m.client.urgentStockNeed.count({ where: { propertyId: { in: propertyIds }, stage: "REPORTED" } })).toBe(2);
    await expect(listUrgentNeedsForOffice(officeCleaner, { filter: "open", q: "", propertyId: null }, officeQuery())).rejects.toThrow("FORBIDDEN");
  });

  it("bulk runs each need through the transition policy and answers per need; a retry records nothing twice", async () => {
    const reported = await officeReport(soonId);
    const ordered = await step(await step(await officeReport(laterId), "ACKNOWLEDGED"), "ORDERED");
    const bulkRequestId = randomUUID();
    const body = { action: "acknowledge", bulkRequestId, reason: "Seen by the office", needs: [{ id: reported.id, expectedVersion: reported.version }, { id: ordered.id, expectedVersion: ordered.version }] };
    const first = await runUrgentStockBulk(officeAdmin, body);
    expect(first.results.map((result) => [result.id, result.outcome, result.message])).toEqual([
      [reported.id, "done", "Recorded."],
      [ordered.id, "refused", "Record each supply stage in order."],
    ]);
    const events = await m.client.urgentStockEvent.count({ where: { needId: reported.id } });
    // A retry answers from the receipt; if another suite cleared receipts, the
    // version check refuses it. Either way nothing is recorded twice.
    const retry = await runUrgentStockBulk(officeAdmin, body);
    expect(["Recorded.", "this report changed. Reload before recording an action."]).toContain(retry.results[0].message);
    expect(await m.client.urgentStockEvent.count({ where: { needId: reported.id } })).toBe(events);
    const stale = await runUrgentStockBulk(officeAdmin, { ...body, bulkRequestId: randomUUID(), action: "mark-ordered", needs: [{ id: reported.id, expectedVersion: reported.version }] });
    expect(stale.results[0]).toMatchObject({ outcome: "refused", message: "this report changed. Reload before recording an action." });
    await expect(runUrgentStockBulk(officeCleaner, { ...body, bulkRequestId: randomUUID() })).rejects.toThrow("FORBIDDEN");
    const event = await m.client.urgentStockEvent.findFirst({ where: { needId: reported.id, kind: "ACKNOWLEDGED" } });
    expect(event).toMatchObject({ fromStage: "REPORTED", toStage: "ACKNOWLEDGED", note: "Seen by the office", actorName: "Office" });
  });
});
}
