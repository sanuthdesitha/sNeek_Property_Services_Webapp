// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { reportUrgentStock as report, actOnUrgentStock as act, listUrgentStock as list, setUrgentStockSettings as settings, dispatchUrgentStockReminders as reminders, nextUrgentStockClean } from "@/lib/inventory/urgent-stock";
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
  await m.client.appSetting.deleteMany({ where: { key: { startsWith: prefix } } });
  await m.client.notificationIntent.deleteMany({ where: { recipientId: adminId } });
  await m.client.notification.deleteMany({ where: { userId: adminId } });
  await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId } } });
  await m.client.propertyStock.updateMany({ where: { propertyId }, data: { onHand: 10, updatedAt: new Date(Date.now() - 3600000) } });
  await m.client.jobAssignment.updateMany({ where: { jobId }, data: { removedAt: null } });
  await m.client.job.update({ where: { id: jobId }, data: { status: "ASSIGNED", cleanSkipStatus: "NONE", scheduledDate: new Date(), startTime: "12:00" } });
 });
 afterAll(async () => {
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
  expect(await m.client.appSetting.count({ where: { key: { startsWith: prefix + "open:" } } })).toBe(1);
  expect(await m.client.appSetting.count({ where: { key: { startsWith: prefix + "event:" } } })).toBe(3);
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
  for (const stage of ["ACKNOWLEDGED", "ORDERED", "DELIVERED"]) { need = await act(cleaner, action(need, stage)); expect(await m.client.appSetting.count({ where: { key: { startsWith: prefix + "open:" } } })).toBe(1); }
  await expect(act(admin, action(initial, "ADMIN_RESOLVED"))).rejects.toThrow("CONFLICT");
  await expect(act(cleaner, action(need, "PROPERTY_CONFIRMED", { observedCount: 2, observedAt: new Date().toISOString(), needResolved: false }))).rejects.toThrow("Confirm a fresh");
  expect((await m.client.propertyStock.findFirst({ where: { propertyId } })).onHand).toBe(10);
  expect(await m.client.stockTx.count({ where: { propertyStock: { propertyId } } })).toBe(0);
  const closed = await act(cleaner, action(need, "PROPERTY_CONFIRMED", { observedCount: 12, observedAt: new Date().toISOString(), needResolved: true }));
  expect(closed.stage).toBe("PROPERTY_CONFIRMED"); expect(await m.client.appSetting.count({ where: { key: { startsWith: prefix + "open:" } } })).toBe(0);
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
