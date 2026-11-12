// @vitest-environment node
/**
 * Laundry partners are suppliers (2026-11-12), on a real disposable
 * PostgreSQL (127.0.0.1:55439): the Suppliers list merges a linked stock
 * supplier and laundry partner into one row, a stock supplier links to at most
 * one partner, the partner's team is LAUNDRY accounts only, deleting a partner
 * unlinks (never deletes) its people, and the "laundry team of this run's
 * supplier" scope follows the live link.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));

import { applyPartnerLinks, loadSupplierDirectory, loadSupplierTeams, PartnerLinkError, teamForRun } from "@/lib/laundry/partners";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `lp-${randomUUID().slice(0, 8)}`;
const stockA = `${tag}-stock-a`;
const stockB = `${tag}-stock-b`;
const ids = { client: randomUUID(), property: randomUUID(), partner: randomUUID(), other: randomUUID(), task: randomUUID(), tom: randomUUID(), ana: randomUUID(), cleaner: randomUUID(), admin: randomUUID() };

describe.skipIf(!url)("laundry partners as suppliers (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    const now = new Date().toISOString();
    const stock = (id: string, name: string) => ({ id, name, email: null, phone: null, website: null, defaultLeadDays: 2, categories: [], notes: null, isActive: true, createdAt: now, updatedAt: now });
    await m.client.appSetting.upsert({
      where: { key: "inventory_supplier_catalog_v1" },
      create: { key: "inventory_supplier_catalog_v1", value: { suppliers: [stock(stockA, `${tag} Fresh Linen`), stock(stockB, `${tag} Paper Co`)] } },
      update: { value: { suppliers: [stock(stockA, `${tag} Fresh Linen`), stock(stockB, `${tag} Paper Co`)] } },
    });
    await m.client.client.create({ data: { id: ids.client, name: `${tag} client` } });
    await m.client.property.create({ data: { id: ids.property, name: `${tag} flat`, clientId: ids.client, address: "1 Test St", suburb: "Bondi" } });
    await m.client.laundrySupplier.createMany({ data: [{ id: ids.partner, name: `${tag} Fresh Linen Laundry`, avgTurnaround: 48 }, { id: ids.other, name: `${tag} Other Laundry` }] });
    await m.client.user.createMany({ data: [
      { id: ids.tom, email: `${tag}-tom@example.invalid`, name: "Tom", role: "LAUNDRY" },
      { id: ids.ana, email: `${tag}-ana@example.invalid`, name: "Ana", role: "LAUNDRY" },
      { id: ids.cleaner, email: `${tag}-cl@example.invalid`, name: "Cleo", role: "CLEANER" },
      { id: ids.admin, email: `${tag}-ad@example.invalid`, name: "Ada", role: "ADMIN" },
    ] });
    const job = await m.client.job.create({ data: { jobNumber: `${tag}-J1`, propertyId: ids.property, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-12T00:00:00Z") } });
    await m.client.laundryTask.create({ data: { id: ids.task, jobId: job.id, propertyId: ids.property, supplierId: ids.partner, pickupDate: new Date("2026-11-12T00:00:00Z"), dropoffDate: new Date("2026-11-13T00:00:00Z") } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.auditLog.deleteMany({ where: { entityId: { in: [ids.partner, ids.other] } } });
    await m.client.laundryTask.deleteMany({ where: { id: ids.task } });
    await m.client.job.deleteMany({ where: { propertyId: ids.property } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.tom, ids.ana, ids.cleaner, ids.admin] } } });
    await m.client.laundrySupplier.deleteMany({ where: { id: { in: [ids.partner, ids.other] } } });
    await m.client.property.deleteMany({ where: { id: ids.property } });
    await m.client.client.deleteMany({ where: { id: ids.client } });
    await m.client.appSetting.deleteMany({ where: { key: "inventory_supplier_catalog_v1" } });
    await m.client.$disconnect();
  });

  it("links a partner to a stock supplier and sets its team, audited; the Suppliers list shows one row with both types", async () => {
    await applyPartnerLinks(ids.admin, ids.partner, { stockSupplierId: stockA, teamUserIds: [ids.tom] });
    const directory = await loadSupplierDirectory();
    const mine = directory.rows.filter((row) => row.name.startsWith(tag));
    expect(mine.map((row) => [row.name, row.kind])).toEqual([
      [`${tag} Fresh Linen`, "BOTH"],
      [`${tag} Other Laundry`, "LAUNDRY"],
      [`${tag} Paper Co`, "STOCK"],
    ]);
    const both = mine[0];
    expect(both.laundry).toMatchObject({ id: ids.partner, avgTurnaround: 48, runCount: 1, team: [{ id: ids.tom, name: "Tom" }] });
    const audit = await m.client.auditLog.findFirst({ where: { action: "LAUNDRY_PARTNER_LINKS_UPDATED", entityId: ids.partner } });
    expect(audit?.after).toMatchObject({ stockSupplierId: stockA, teamUserIds: [ids.tom] });
  });

  it("refuses a second link to the same stock supplier, a missing one, and a non-laundry team member", async () => {
    await expect(applyPartnerLinks(ids.admin, ids.other, { stockSupplierId: stockA })).rejects.toMatchObject({ status: 409 });
    await expect(applyPartnerLinks(ids.admin, ids.other, { stockSupplierId: `${tag}-gone` })).rejects.toBeInstanceOf(PartnerLinkError);
    await expect(applyPartnerLinks(ids.admin, ids.other, { teamUserIds: [ids.cleaner] })).rejects.toMatchObject({ status: 400 });
    expect((await m.client.laundrySupplier.findUnique({ where: { id: ids.other } }))?.stockSupplierId).toBeNull();
  });

  it("addresses only the run's partner team, and follows a person moved to another partner", async () => {
    const recipient = (userId: string) => ({ userId, role: "LAUNDRY" as const, scope: { kind: "ENTITY" as const, type: "LAUNDRY_TASK_SUPPLIER_TEAM", id: ids.task } });
    expect(await authorizeEntityRecipient(m.client, recipient(ids.tom))).toEqual({ ok: true, role: "LAUNDRY" });
    expect(await authorizeEntityRecipient(m.client, recipient(ids.ana))).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
    const teams = await loadSupplierTeams([ids.partner]);
    expect(teamForRun(teams, ids.partner, { accessInfo: null, laundryEnabled: true }).map((member) => member.id)).toEqual([ids.tom]);
    await applyPartnerLinks(ids.admin, ids.other, { teamUserIds: [ids.tom] });
    expect(await authorizeEntityRecipient(m.client, recipient(ids.tom))).toEqual({ ok: false, errorCode: "recipient_not_in_scope" });
  });

  it("deleting a partner unlinks its people and keeps the accounts", async () => {
    await m.client.laundrySupplier.delete({ where: { id: ids.other } });
    const tom = await m.client.user.findUnique({ where: { id: ids.tom } });
    expect(tom).toMatchObject({ isActive: true, laundrySupplierId: null });
  });
});
