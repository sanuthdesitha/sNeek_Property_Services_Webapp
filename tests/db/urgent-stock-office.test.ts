// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { listUrgentStock, reportUrgentStock, actOnUrgentStock } from "@/lib/inventory/urgent-stock";
import { countUrgentNeedsAwaitingAcknowledgement, listUrgentNeedsForOffice } from "@/lib/inventory/urgent-stock-list";
import { runUrgentStockBulk } from "@/lib/inventory/urgent-stock-bulk";
import { parseListQuery } from "@/lib/admin/list-query";
import { URGENT_SORTS } from "@/lib/inventory/urgent-stock-actions";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const [adminId, cleanerId, clientId, soonId, laterId, noCleanId, itemId] = Array.from({ length: 7 }, () => randomUUID());
const admin = { id: adminId, role: Role.ADMIN }, cleaner = { id: cleanerId, role: Role.CLEANER };
const propertyIds = [soonId, laterId, noCleanId];
const query = (search = "") => parseListQuery(new URLSearchParams(search), { sortable: URGENT_SORTS, defaultSort: "neededBy", defaultDir: "asc" });
const report = (propertyId: string, note = "Needed") => reportUrgentStock(admin, { propertyId, itemId, requestId: randomUUID(), observedCount: null, observedAt: null, purchaseQuantity: 4, note });
const step = (need: any, stage: string) => actOnUrgentStock(admin, { reportId: need.id, requestId: randomUUID(), expectedVersion: need.version, stage, reason: "Fixture", observedCount: null, observedAt: null, needResolved: false });

describe.skipIf(!url)("urgent stock office list, bulk and table parity (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [{ id: adminId, email: `${adminId}@example.invalid`, role: Role.ADMIN, name: "Office" }, { id: cleanerId, email: `${cleanerId}@example.invalid`, role: Role.CLEANER }] });
    await m.client.client.create({ data: { id: clientId, name: "Urgent fixture client" } });
    await m.client.property.createMany({ data: propertyIds.map((id, index) => ({ id, name: `Urgent ${["A soon", "B later", "C none"][index]}`, clientId, address: "x", suburb: "y", inventoryEnabled: true })) });
    await m.client.inventoryItem.create({ data: { id: itemId, name: "Fixture soap", category: "Fixture", unit: "bottle" } });
    await m.client.propertyStock.createMany({ data: propertyIds.map((propertyId) => ({ propertyId, itemId, onHand: 1, parLevel: propertyId === soonId ? 6 : 0 })) });
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
    await m.client.notificationIntent.deleteMany({ where: { recipientId: adminId } });
  });
  afterAll(async () => {
    await m.client.urgentStockEvent.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.urgentStockNeed.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: adminId } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "urgent_stock_v1:receipt:" } } });
    await m.client.auditLog.deleteMany({ where: { userId: adminId } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId: { in: propertyIds } } } });
    await m.client.propertyStock.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.job.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.property.deleteMany({ where: { id: { in: propertyIds } } });
    await m.client.client.delete({ where: { id: clientId } });
    await m.client.inventoryItem.delete({ where: { id: itemId } });
    await m.client.user.deleteMany({ where: { id: { in: [adminId, cleanerId] } } });
    await m.client.$disconnect();
  });

  it("returns a migrated row exactly as its JSON was stored (same keys, values and ISO strings)", async () => {
    const stored = { id: randomUUID(), propertyId: soonId, itemId, propertyName: "Urgent A soon", itemName: "Fixture soap", unit: "bottle", stage: "ACKNOWLEDGED", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T03:04:05.678Z", version: 2, observedCount: 0, purchaseQuantity: 12.5, observedAt: "2026-11-01T10:00:00+11:00", observationDisposition: "APPLY", note: "Out of soap", lastReminderAt: null, remindersSent: 0 };
    await m.client.urgentStockNeed.create({ data: { ...stored, createdAt: new Date(stored.createdAt), updatedAt: new Date(stored.updatedAt), openPairKey: `urgent_stock_v1:open:${randomUUID()}` } });
    const event = { reportId: stored.id, propertyId: soonId, actorId: null, actorName: "Reminder worker", kind: "REMINDER", at: "2026-11-02T03:04:05.678Z", detail: { nextCleanAt: null, number: 1 } };
    await m.client.urgentStockEvent.create({ data: { id: randomUUID(), needId: stored.id, propertyId: soonId, actorId: null, actorName: event.actorName, kind: event.kind, detail: event.detail, at: new Date(event.at) } });
    const result = await listUrgentStock(admin, soonId, stored.id);
    // Same keys and values (the old JSONB store did not keep key order either).
    expect(result.reports[0]).toStrictEqual(stored);
    expect(result.events[0]).toStrictEqual(event);
    expect(Object.keys(result)).toEqual(["properties", "items", "reports", "events", "nextCleanAt", "settings"]);
  });

  it("lists every property sorted by the next clean that needs the item; unknown last; closed has none", async () => {
    const later = await report(laterId), soon = await report(soonId), none = await report(noCleanId);
    const ordered = await listUrgentNeedsForOffice(admin, { filter: "open", q: "", propertyId: null }, query());
    expect(ordered.rows.map((row) => row.propertyId)).toEqual([soonId, laterId, noCleanId]);
    expect(ordered.rows.map((row) => row.neededByState)).toEqual(["upcoming", "upcoming", "unknown"]);
    expect(ordered.rows[0]).toMatchObject({ parLevel: 6, suggestedBuy: null, purchaseQuantity: 4, reportedByName: "Office" });
    expect(ordered.rows[2]).toMatchObject({ parLevel: null, neededBy: null });
    expect(ordered.summary).toEqual({ open: 3, properties: 3, dueSoon: 1 });
    expect(ordered.counts).toMatchObject({ open: 3, REPORTED: 3, closed: 0, all: 3 });
    const reversed = await listUrgentNeedsForOffice(admin, { filter: "open", q: "", propertyId: null }, query("sort=neededBy&dir=desc"));
    expect(reversed.rows.map((row) => row.propertyId)).toEqual([laterId, soonId, noCleanId]);
    await step(none, "ADMIN_RESOLVED");
    const closed = await listUrgentNeedsForOffice(admin, { filter: "closed", q: "", propertyId: null }, query());
    expect(closed.rows).toHaveLength(1);
    expect(closed.rows[0]).toMatchObject({ id: none.id, neededBy: null, neededByState: "closed" });
    const paged = await listUrgentNeedsForOffice(admin, { filter: "all", q: "urgent b", propertyId: null }, query("pageSize=1"));
    expect(paged).toMatchObject({ total: 1, pageCount: 1 });
    expect(paged.rows[0].id).toBe(later.id);
    expect(soon.id).not.toBe(later.id);
    expect(await countUrgentNeedsAwaitingAcknowledgement()).toBe(2);
    await expect(listUrgentNeedsForOffice(cleaner, { filter: "open", q: "", propertyId: null }, query())).rejects.toThrow("FORBIDDEN");
  });

  it("bulk runs each need through the transition policy and answers per need; a retry records nothing twice", async () => {
    const reported = await report(soonId);
    const ordered = await step(await step(await report(laterId), "ACKNOWLEDGED"), "ORDERED");
    const bulkRequestId = randomUUID();
    const body = { action: "acknowledge", bulkRequestId, reason: "Seen by the office", needs: [{ id: reported.id, expectedVersion: reported.version }, { id: ordered.id, expectedVersion: ordered.version }] };
    const first = await runUrgentStockBulk(admin, body);
    expect(first.results.map((result) => [result.id, result.outcome, result.message])).toEqual([
      [reported.id, "done", "Recorded."],
      [ordered.id, "refused", "Record each supply stage in order."],
    ]);
    const events = await m.client.urgentStockEvent.count({ where: { needId: reported.id } });
    const retry = await runUrgentStockBulk(admin, body);
    expect(retry.results[0]).toMatchObject({ outcome: "done" });
    expect(await m.client.urgentStockEvent.count({ where: { needId: reported.id } })).toBe(events);
    const stale = await runUrgentStockBulk(admin, { ...body, bulkRequestId: randomUUID(), action: "mark-ordered", needs: [{ id: reported.id, expectedVersion: reported.version }] });
    expect(stale.results[0]).toMatchObject({ outcome: "refused", message: "this report changed. Reload before recording an action." });
    await expect(runUrgentStockBulk(cleaner, { ...body, bulkRequestId: randomUUID() })).rejects.toThrow("FORBIDDEN");
    const event = await m.client.urgentStockEvent.findFirst({ where: { needId: reported.id, kind: "ACKNOWLEDGED" } });
    expect(event).toMatchObject({ fromStage: "REPORTED", toStage: "ACKNOWLEDGED", note: "Seen by the office", actorName: "Office" });
  });
});
