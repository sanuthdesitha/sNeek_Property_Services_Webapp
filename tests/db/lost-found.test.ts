// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
import { createLostFoundItem } from "@/lib/lost-found/create";
import { applyLostFoundChange } from "@/lib/lost-found/mutations";
import { runLostFoundBulk } from "@/lib/lost-found/bulk";
import { listLostFoundForOffice, parseLostFoundFilters } from "@/lib/lost-found/list";
import { hydrateItemWithEvents, redactItemWithEventsForReporter } from "@/lib/lost-found/service";
import { parseListQuery } from "@/lib/admin/list-query";
import { LOST_FOUND_SORTS } from "@/lib/lost-found/list-options";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const [officeId, cleanerId, clientId, propertyId, otherPropertyId, bookingId, jobWithBooking, jobWithout] = Array.from({ length: 8 }, () => randomUUID());
const query = (search: string) => parseListQuery(new URLSearchParams(search), { sortable: LOST_FOUND_SORTS, defaultSort: "found", defaultDir: "asc" });

/** The migration's two backfill statements, run again as a later "sync" would. */
function backfillStatements(): string[] {
  const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261111200000_lost_found_guest_urgent_stock_tables/migration.sql"), "utf8");
  return sql.replace(/^\s*--.*$/gm, "").split(";").map((part) => part.trim()).filter((part) => part.startsWith('UPDATE "LostFoundItem"'));
}

describe.skipIf(!url)("lost and found with guest import (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [{ id: officeId, email: `${officeId}@example.invalid`, role: Role.ADMIN, name: "Office" }, { id: cleanerId, email: `${cleanerId}@example.invalid`, role: Role.CLEANER, name: "Jane C." }] });
    await m.client.client.create({ data: { id: clientId, name: "Harbour Stays" } });
    await m.client.property.createMany({ data: [{ id: propertyId, name: "LF Bondi", clientId, address: "1 Test St", suburb: "Bondi" }, { id: otherPropertyId, name: "LF Manly", clientId, address: "2 Test St", suburb: "Manly" }] });
    await m.client.reservation.create({ data: { id: bookingId, propertyId, uid: `lf-${bookingId}`, startDate: new Date("2026-11-08"), endDate: new Date("2026-11-11"), guestName: "Priya Shah", guestPhone: "+61 400 111 222", guestEmail: "priya@example.invalid", reservationCode: "HMDEPART1", adults: 2, children: 1, source: "airbnb" } });
    await m.client.job.createMany({ data: [
      { id: jobWithBooking, jobNumber: `LF-${jobWithBooking}`, propertyId, reservationId: bookingId, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-11") },
      { id: jobWithout, jobNumber: `LF-${jobWithout}`, propertyId, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-11") },
    ] });
  });
  beforeEach(async () => {
    await m.client.lostFoundItem.deleteMany({ where: { propertyId: { in: [propertyId, otherPropertyId] } } });
    await m.client.appSetting.deleteMany({ where: { key: "lost_found_v1:settings" } });
  });
  afterAll(async () => {
    await m.client.lostFoundItem.deleteMany({ where: { propertyId: { in: [propertyId, otherPropertyId] } } });
    await m.client.job.deleteMany({ where: { id: { in: [jobWithBooking, jobWithout] } } });
    await m.client.reservation.deleteMany({ where: { id: bookingId } });
    await m.client.property.deleteMany({ where: { id: { in: [propertyId, otherPropertyId] } } });
    await m.client.client.delete({ where: { id: clientId } });
    await m.client.user.deleteMany({ where: { id: { in: [officeId, cleanerId] } } });
    await m.client.$disconnect();
  });

  const log = (jobId: string | null, itemName = "Watch", by = cleanerId) => createLostFoundItem({ actorId: by, propertyId, jobId, itemName, location: "Bedside", notes: null, photos: [], loggedBy: by === cleanerId ? "CLEANER" : "OFFICE" });

  it("copies the departing booking's guest on create, and records it as a system entry the cleaner never sees", async () => {
    const item = await log(jobWithBooking);
    expect(item).toMatchObject({ guestName: "Priya Shah", guestContact: "+61 400 111 222", guestEmail: "priya@example.invalid", reservationId: bookingId, guestSource: "BOOKING" });
    const events = await m.client.lostFoundEvent.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event: any) => [event.action, event.userId])).toEqual([["REPORTED", cleanerId], ["GUEST_IMPORTED", null]]);
    const detail = await hydrateItemWithEvents(item, events);
    expect(detail.booking).toMatchObject({ reservationCode: "HMDEPART1", source: "airbnb", partyLabel: "2 adults · 1 child" });
    expect(detail.clientName).toBe("Harbour Stays");
    const forCleaner = redactItemWithEventsForReporter(detail, events, cleanerId);
    expect(JSON.stringify(forCleaner)).not.toMatch(/Priya|priya|400 111|HMDEPART1|Harbour/);
  });

  it("copies nothing when the job has no booking, and refuses a job at another property", async () => {
    const item = await log(jobWithout);
    expect(item).toMatchObject({ guestName: null, guestContact: null, guestEmail: null, reservationId: null, guestSource: null });
    expect((await hydrateItemWithEvents(item, [])).jobHasBooking).toBe(false);
    await expect(createLostFoundItem({ actorId: officeId, propertyId: otherPropertyId, jobId: jobWithBooking, itemName: "X", location: null, notes: null, photos: [], loggedBy: "OFFICE" })).rejects.toThrow("not at this property");
  });

  it("an office edit is MANUAL and neither a booking change nor the backfill ever overwrites it", async () => {
    const item = await log(jobWithBooking);
    await applyLostFoundChange(item.id, officeId, { details: { guestName: "Correct Guest", guestContact: "0400 000 001" } });
    await m.client.reservation.update({ where: { id: bookingId }, data: { guestName: "Changed In Sync" } });
    const legacy = await m.client.lostFoundItem.create({ data: { propertyId, jobId: jobWithBooking, itemName: "Legacy, no guest", status: "IN_STORAGE" } });
    const typed = await m.client.lostFoundItem.create({ data: { propertyId, jobId: jobWithBooking, itemName: "Legacy, typed guest", guestName: "Typed", status: "IN_STORAGE" } });
    const statements = backfillStatements();
    expect(statements).toHaveLength(2);
    for (const statement of statements) await m.client.$executeRawUnsafe(statement);
    expect(await m.client.lostFoundItem.findUnique({ where: { id: item.id } })).toMatchObject({ guestName: "Correct Guest", guestContact: "0400 000 001", guestSource: "MANUAL" });
    expect(await m.client.lostFoundItem.findUnique({ where: { id: legacy.id } })).toMatchObject({ guestName: "Changed In Sync", guestSource: "BOOKING", reservationId: bookingId });
    expect(await m.client.lostFoundItem.findUnique({ where: { id: typed.id } })).toMatchObject({ guestName: "Typed", guestContact: null, guestEmail: null, reservationId: null, guestSource: "MANUAL" });
    await m.client.reservation.update({ where: { id: bookingId }, data: { guestName: "Priya Shah" } });
  });

  it("reopening keeps the previous decision in history; bulk answers per item", async () => {
    const a = await log(null, "A"), b = await log(null, "B");
    await applyLostFoundChange(a.id, officeId, { status: { status: "DONATED", resolution: "Vinnies" } });
    await expect(applyLostFoundChange(a.id, officeId, { status: { status: "IN_STORAGE" } })).rejects.toThrow("reason");
    const reopened = await applyLostFoundChange(a.id, officeId, { status: { status: "IN_STORAGE", reopenReason: "Guest called" } });
    expect(reopened).toMatchObject({ status: "IN_STORAGE", resolvedAt: null, resolution: null });
    const event = await m.client.lostFoundEvent.findFirst({ where: { itemId: a.id, action: "REOPENED" } });
    expect(event.meta.previousResolution).toMatchObject({ status: "DONATED", resolution: "Vinnies", resolvedByUserId: officeId });
    await applyLostFoundChange(b.id, officeId, { status: { status: "RETURNED" } });
    const { results } = await runLostFoundBulk(officeId, { action: "mark-unclaimed", ids: [a.id, b.id, "missing"], note: "Held 14 days" });
    expect(results).toEqual([
      { id: a.id, outcome: "done", message: "Updated." },
      { id: b.id, outcome: "refused", message: "Reopen the item first to record a different final decision." },
      { id: "missing", outcome: "refused", message: "This item no longer exists." },
    ]);
    expect(await m.client.lostFoundItem.findUnique({ where: { id: a.id } })).toMatchObject({ status: "UNCLAIMED", resolution: "Held 14 days", resolvedByUserId: officeId });
  });

  it("pages, sorts and counts on the server, and flags the holding period", async () => {
    const old = new Date(Date.now() - 20 * 86_400_000);
    for (const [name, status, createdAt] of [["Old shelf", "IN_STORAGE", old], ["New one", "REPORTED", new Date()], ["Recent shelf", "IN_STORAGE", new Date()], ["Gone", "DONATED", old]] as const) {
      await m.client.lostFoundItem.create({ data: { propertyId, itemName: name, status, createdAt } });
    }
    // Scoped to this suite's property; the header summary is global by design.
    const page = await listLostFoundForOffice(parseLostFoundFilters(new URLSearchParams(`stage=storage&propertyId=${propertyId}`)), query("page=1&pageSize=1&sort=found&dir=asc"));
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1, pageCount: 2, holdingDays: 14 });
    expect(page.summary.open).toBeGreaterThanOrEqual(3);
    expect(page.summary.pastHolding).toBeGreaterThanOrEqual(1);
    expect(page.counts).toMatchObject({ new: 1, storage: 2, closed: 1, all: 4 });
    expect(page.rows.map((row) => [row.itemName, row.holding.past])).toEqual([["Old shelf", true]]);
    const flagged = await listLostFoundForOffice(parseLostFoundFilters(new URLSearchParams(`stage=all&holding=past&propertyId=${propertyId}`)), query("sort=item&dir=desc"));
    expect(flagged.rows.map((row) => row.itemName)).toEqual(["Old shelf"]);
    const searched = await listLostFoundForOffice(parseLostFoundFilters(new URLSearchParams(`stage=all&q=lf bondi`)), query("sort=item&dir=asc"));
    expect(searched.total).toBe(4);
  });
});
