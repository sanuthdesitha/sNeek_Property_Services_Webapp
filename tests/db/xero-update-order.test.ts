// @vitest-environment node
/**
 * Update in Xero and order-only reorder (2026-11-18) on a real PostgreSQL
 * database: the row lock, metadata and audit rows. Xero is mocked at its
 * client boundary; no real Xero call is made.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, read: vi.fn(), update: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: false }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({}) }));
vi.mock("@/lib/xero/client", () => ({
  readXeroInvoice: m.read,
  readXeroCreditNote: vi.fn(),
  updateClientDocumentInXero: m.update,
  pushClientInvoiceToXero: vi.fn(),
  pushClientCreditNoteToXero: vi.fn(),
}));

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { updateClientInvoiceInXero } from "@/lib/billing/client-invoice-xero-update";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
let l1 = "";
let l2 = "";
/** The PATCH validates line ids as cuids. */
const cuid = () => `c${randomUUID().replace(/-/g, "").slice(0, 24)}`;
const day = new Date("2026-10-01T00:00:00Z");
const actor = () => ({ id, role: "ADMIN", name: "Admin", email: `${id}@example.invalid` });

describe.skipIf(!url)("Update in Xero on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Disposable loopback PostgreSQL on 55439 required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    id = `xeroupd-${randomUUID()}`;
    l1 = cuid();
    l2 = cuid();
    await m.client.client.create({ data: { id, name: "Xero update fixture" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN", isActive: true } });
    await m.client.property.create({ data: { id: `${id}-m`, clientId: id, name: "Manly House", address: "1 Test Street", suburb: "Manly" } });
    await m.client.property.create({ data: { id: `${id}-b`, clientId: id, name: "Bondi Flat", address: "2 Test Street", suburb: "Bondi" } });
    await m.client.clientInvoice.create({ data: {
      id, clientId: id, invoiceNumber: id, status: "APPROVED", subtotal: 270, totalAmount: 270, gstEnabled: false,
      xeroInvoiceId: `${id}-xero`, xeroExportedAt: day, metadata: { xeroExportState: "EXPORTED" },
      lines: { create: [
        { id: l1, description: "Window clean", quantity: 1, unitPrice: 150, lineTotal: 150, category: "SERVICE", propertyId: `${id}-m`, sortOrder: 0 },
        { id: l2, description: "Oven clean", quantity: 1, unitPrice: 120, lineTotal: 120, category: "SERVICE", propertyId: `${id}-b`, sortOrder: 1 },
      ] },
    } });
    m.read.mockResolvedValue({ ok: true, document: {
      id: `${id}-xero`, kind: "ACCREC", status: "AUTHORISED", total: 270, amountDue: 270, amountPaid: 0, amountCredited: 0, payments: [], hasOverOrPrepayments: false, updatedAt: null,
      lineItems: [{ description: "Window clean", quantity: 1, unitAmount: 150 }, { description: "Oven clean", quantity: 1, unitAmount: 120 }],
    } });
    m.update.mockImplementation(async (input: { xeroId: string }) => ({ id: input.xeroId, status: "AUTHORISED", total: 270 }));
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    await m.client.auditLog.deleteMany({ where: { userId: id } });
    await m.client.clientInvoiceLine.deleteMany({ where: { invoice: { clientId: id } } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: id } });
    await m.client.property.deleteMany({ where: { clientId: id } });
    await m.client.user.deleteMany({ where: { id } });
    await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => m.client?.$disconnect());

  it("re-orders a pushed approved invoice (order only) and refuses an amount edit", async () => {
    const reorder = await patchClientInvoice({ invoiceId: id, body: { reorderLineIds: [l2, l1] }, actor: actor() });
    expect(reorder.status).toBeLessThan(400);
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: id }, orderBy: { sortOrder: "asc" } });
    expect(lines.map((line) => line.id)).toEqual([l2, l1]);
    const edit = await patchClientInvoice({ invoiceId: id, body: { updateLines: [{ id: l1, unitPrice: 999 }] }, actor: actor() });
    expect(edit.status).toBe(409);
    const stored = await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: l1 } });
    expect(stored.unitPrice).toBe(150);
  });

  it("updates the same Xero document with the grouped, prefixed lines and records the audit row", async () => {
    const result = await updateClientInvoiceInXero({ invoiceId: id, actor: actor(), requestKey: "request-key-1" });
    expect(result.status).toBe(200);
    expect(m.update.mock.calls[0][0].xeroId).toBe(`${id}-xero`);
    expect(m.update.mock.calls[0][0].lineItems.map((line: { description: string }) => line.description)).toEqual(["Bondi Flat - Oven clean", "Manly House - Window clean"]);
    const after = await m.client.clientInvoice.findUniqueOrThrow({ where: { id } });
    expect(after.xeroInvoiceId).toBe(`${id}-xero`);
    expect(after.metadata).toMatchObject({ xeroExportState: "EXPORTED", xeroUpdate: { state: "DONE", key: "request-key-1", change: "descriptions", xeroStatusBefore: "AUTHORISED" } });
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: id }, orderBy: { sortOrder: "asc" } });
    expect(lines.map((line) => line.id)).toEqual([l1, l2]);
    const rows = await m.client.auditLog.findMany({ where: { entityId: id, action: "CLIENT_INVOICE_XERO_UPDATE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ outcome: "updated", localTotal: 270, xeroTotalBefore: 270, xeroStatusBefore: "AUTHORISED", totalsDiffered: false });
    // The same confirmation again is not sent twice.
    const again = await updateClientInvoiceInXero({ invoiceId: id, actor: actor(), requestKey: "request-key-1" });
    expect(again.body).toMatchObject({ repeated: true });
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it("records Xero's refusal without un-pushing the invoice", async () => {
    m.update.mockRejectedValue(new Error("Xero API error (400): The period is locked"));
    const result = await updateClientInvoiceInXero({ invoiceId: id, actor: actor(), requestKey: "request-key-2" });
    expect(result.status).toBe(502);
    const after = await m.client.clientInvoice.findUniqueOrThrow({ where: { id } });
    expect(after.xeroInvoiceId).toBe(`${id}-xero`);
    expect(after.xeroExportedAt?.toISOString()).toBe(day.toISOString());
    expect(after.metadata).toMatchObject({ xeroExportState: "EXPORTED", xeroUpdate: { state: "FAILED", reason: "Xero API error (400): The period is locked" } });
    const rows = await m.client.auditLog.findMany({ where: { entityId: id, action: "CLIENT_INVOICE_XERO_UPDATE" } });
    expect(rows[0].after).toMatchObject({ outcome: "failed" });
  });
});
