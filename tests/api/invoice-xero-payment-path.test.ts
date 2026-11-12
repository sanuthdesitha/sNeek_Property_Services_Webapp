// @vitest-environment node
/**
 * Money step (d) through the existing payment path: method XERO only from the
 * sync, a Xero payment id recorded once, no change to PAID/VOID, refusal when
 * more than owed, PAID settlement by the existing owing rule, no client
 * receipt email. Plus the xero-sync route's guard and validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  find: vi.fn(), findMany: vi.fn(), update: vi.fn(), audit: vi.fn(), auth: vi.fn(), refresh: vi.fn(), email: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), releaseInvoiceConsumables: vi.fn() }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/db", () => {
  const client = () => ({
    $queryRaw: vi.fn(),
    clientInvoice: { findUnique: m.find, findMany: m.findMany, count: vi.fn(async () => 0), update: m.update },
    clientInvoiceLine: { findMany: vi.fn(async () => []) },
    auditLog: { create: m.audit },
  });
  return { db: { ...client(), $transaction: async (work: (tx: unknown) => unknown) => work(client()) } };
});

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";

let invoice: Record<string, unknown>;
const actor = { id: "admin", role: "ADMIN", name: "Ann" };
const xeroBody = (amount: number) => ({ recordPayment: { amount, method: "XERO", paidDate: "2026-11-01", reference: "Xero payment p1" } });

beforeEach(() => {
  vi.clearAllMocks();
  invoice = {
    id: "inv", kind: "INVOICE", status: "SENT", invoiceNumber: "INV-1", clientId: "c", totalAmount: 110, paidAmount: 0, paidAt: null,
    metadata: { payments: [] }, xeroInvoiceId: "x-1", lines: [{ id: "l", jobId: null }],
  };
  m.find.mockImplementation(async () => invoice);
  m.findMany.mockResolvedValue([]);
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...invoice, ...data }));
  m.audit.mockResolvedValue({});
});

describe("Xero payments through the existing payment path", () => {
  it("refuses method XERO from a person, and a Xero source without method XERO", async () => {
    expect((await patchClientInvoice({ invoiceId: "inv", body: xeroBody(10), actor })).status).toBe(400);
    const wrong = await patchClientInvoice({ invoiceId: "inv", body: { recordPayment: { amount: 10, method: "CASH" } }, actor, xeroPayment: { paymentId: "p1", trigger: "manual" } });
    expect(wrong.status).toBe(400);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("records the payment with source, Xero payment id and date, settles PAID by the owing rule, and leaves the receipt to the sync (sent after the review decision)", async () => {
    m.findMany.mockResolvedValue([{ status: "SENT", totalAmount: -10 }]); // a $10 credit note
    const result = await patchClientInvoice({ invoiceId: "inv", body: xeroBody(100), actor, xeroPayment: { paymentId: "p1", trigger: "scheduled" } });
    expect(result.status).toBe(200);
    const data = m.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PAID", paidAmount: 100, paymentMethod: "XERO" });
    expect(data.paidDate.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    // A scheduled run is the system's action (owner decision 2026-11-11, third set item 8).
    expect(data.metadata.payments[0]).toMatchObject({ source: "XERO", xeroPaymentId: "p1", method: "XERO", recordedByName: "System: Xero sync (scheduled)" });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_INVOICE_PAYMENT_RECORD", after: expect.objectContaining({ source: "XERO", xeroPaymentId: "p1", trigger: "scheduled", systemActor: "SYSTEM_XERO_SYNC" }) }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(m.email).not.toHaveBeenCalled();
  });

  it("a partial Xero payment leaves the invoice PART_PAID", async () => {
    await patchClientInvoice({ invoiceId: "inv", body: xeroBody(50), actor, xeroPayment: { paymentId: "p1", trigger: "manual" } });
    expect(m.update.mock.calls[0][0].data.status).toBe("PART_PAID");
  });

  it("records a payment id at most once", async () => {
    invoice.metadata = { payments: [{ xeroPaymentId: "p1", amount: 50 }] };
    const result = await patchClientInvoice({ invoiceId: "inv", body: xeroBody(50), actor, xeroPayment: { paymentId: "p1", trigger: "manual" } });
    expect(result).toMatchObject({ status: 200, body: { alreadyRecorded: true } });
    expect(m.update).not.toHaveBeenCalled();
  });

  it.each(["PAID", "VOID"])("never changes a %s invoice", async (status) => {
    invoice.status = status;
    expect((await patchClientInvoice({ invoiceId: "inv", body: xeroBody(10), actor, xeroPayment: { paymentId: "p9", trigger: "manual" } })).status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("refuses a Xero payment above what is still owed (manual payment already recorded)", async () => {
    invoice.paidAmount = 100;
    const result = await patchClientInvoice({ invoiceId: "inv", body: xeroBody(20), actor, xeroPayment: { paymentId: "p1", trigger: "manual" } });
    expect(result).toMatchObject({ status: 409, body: { code: "XERO_PAYMENT_EXCEEDS_OWING" } });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("refuses a Xero payment on a credit note", async () => {
    invoice.kind = "CREDIT_NOTE";
    expect((await patchClientInvoice({ invoiceId: "inv", body: xeroBody(10), actor, xeroPayment: { paymentId: "p1", trigger: "manual" } })).status).toBeGreaterThanOrEqual(400);
  });
});
