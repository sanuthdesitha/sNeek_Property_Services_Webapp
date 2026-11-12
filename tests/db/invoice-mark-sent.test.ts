// @vitest-environment node
/**
 * Parity audit 2026-11-12: "Mark as sent (not emailed)" on a real PostgreSQL
 * database. The PATCH to SENT snapshots terms and the first-sent day, locks
 * editing, and writes its "marked sent without email" audit row in the same
 * transaction; a refused move writes nothing.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: false }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({}) }));

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const day = new Date("2026-09-10T00:00:00Z");
const actor = () => ({ id, role: "OPS_MANAGER", name: "Ops", email: `${id}@example.invalid` });

describe.skipIf(!url)("Mark as sent (not emailed) on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Disposable loopback PostgreSQL on 55439 required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `marksent-${randomUUID()}`;
    await m.client.client.create({ data: { id, name: "Mark sent fixture", paymentTermsDays: 7 } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "OPS_MANAGER", isActive: true } });
    await m.client.property.create({ data: { id, clientId: id, name: "Fixture property", address: "1 Test Street", suburb: "Sydney" } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "GENERAL_CLEAN", status: "COMPLETED", scheduledDate: day, completedAt: day, fixedPrice: 100 } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    await m.client.auditLog.deleteMany({ where: { userId: id } });
    await m.client.clientInvoiceLine.deleteMany({ where: { invoice: { clientId: id } } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: id } });
    await m.client.job.deleteMany({ where: { propertyId: id } });
    await m.client.property.deleteMany({ where: { clientId: id } });
    await m.client.user.deleteMany({ where: { id } });
    await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => m.client?.$disconnect());

  async function invoice(status: "DRAFT" | "APPROVED") {
    return m.client.clientInvoice.create({ data: {
      id, clientId: id, invoiceNumber: id, status, subtotal: 100, totalAmount: 100, gstEnabled: false,
      lines: { create: [{ jobId: id, description: "Clean", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" }] },
    } });
  }

  it("moves an approved invoice to SENT with terms, first-sent day and the audit row", async () => {
    await invoice("APPROVED");
    const result = await patchClientInvoice({ invoiceId: id, body: { status: "SENT" }, actor: actor() });
    expect(result.status).toBe(200);
    const after = await m.client.clientInvoice.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe("SENT");
    expect(after.sentAt).not.toBeNull();
    expect(after.paymentTermsDays).toBe(7);
    const rows = await m.client.auditLog.findMany({ where: { entityId: id, action: "CLIENT_INVOICE_MARKED_SENT" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ emailed: false, note: "Marked sent without email", status: "SENT" });
    // Editing is locked once sent.
    const edit = await patchClientInvoice({ invoiceId: id, body: { gstEnabled: true }, actor: actor() });
    expect(edit.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a draft whose job has no rate and leaves no audit row", async () => {
    await m.client.job.update({ where: { id }, data: { fixedPrice: null } });
    await invoice("DRAFT");
    await m.client.clientInvoiceLine.updateMany({ where: { invoiceId: id }, data: { unitPrice: 0, lineTotal: 0 } });
    await m.client.clientInvoice.update({ where: { id }, data: { subtotal: 0, totalAmount: 0 } });
    const result = await patchClientInvoice({ invoiceId: id, body: { status: "SENT" }, actor: actor() });
    expect(result.status).toBe(409);
    expect((await m.client.clientInvoice.findUniqueOrThrow({ where: { id } })).status).toBe("DRAFT");
    expect(await m.client.auditLog.count({ where: { entityId: id, action: "CLIENT_INVOICE_MARKED_SENT" } })).toBe(0);
  });
});
