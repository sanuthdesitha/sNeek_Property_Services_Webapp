// @vitest-environment node
/**
 * Order only on an invoice already in Xero (2026-11-18): a draft or approved
 * invoice in Xero may have its lines re-ordered (so "Update in Xero" can carry
 * the order), while every amount or content edit stays refused. Also the Xero
 * transport of "Update in Xero" and the reading of Xero's lines. Xero is not
 * contacted: fetch is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  invoice: null as any,
  update: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
  connection: vi.fn(),
  fetch: vi.fn(),
}));

function store() {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    clientInvoice: { findUnique: vi.fn(async () => m.invoice), update: m.update, findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    clientInvoiceLine: { findMany: vi.fn(async () => m.invoice.lines), update: vi.fn(), create: vi.fn(), delete: vi.fn(), updateMany: m.updateMany },
    client: { findUnique: vi.fn(async () => ({ paymentTermsDays: 7 })) },
    job: { findMany: vi.fn(async () => []) },
    property: { findMany: vi.fn(async () => []) },
    auditLog: { create: m.audit },
    xeroConnection: { findFirst: m.connection },
  };
}

vi.mock("@/lib/db", () => {
  const db: any = { xeroConnection: { findFirst: m.connection } };
  db.$transaction = async (work: any) => work(Object.assign(store(), { $transaction: db.$transaction }));
  return { db };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Test", invoicing: { defaultPaymentTermsDays: 14 } }) }));

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { invoiceOrderLock, ORDER_ONLY_LINES_REFUSAL, XERO_ISSUED_REFUSAL } from "@/lib/billing/client-invoice-guards";
import { updateClientDocumentInXero } from "@/lib/xero/client";
import { parseXeroDocument } from "@/lib/xero/xero-documents";
import { availableInvoiceActions } from "@/components/v2/admin/finance/invoices/invoice-model";
import { compareXeroLines, xeroUpdateAvailability } from "@/lib/billing/client-invoice-xero-update-rules";

const A = "cl00000000000000000000001";
const B = "cl00000000000000000000002";
const actor = { id: "ops", role: "OPS_MANAGER" };

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice", kind: "INVOICE", invoiceNumber: "INV-1", status: "APPROVED", clientId: "client",
    subtotal: 100, gstAmount: 10, totalAmount: 110, gstEnabled: true, paidAt: null, paidAmount: null, sentAt: null,
    paymentTermsDays: null, xeroInvoiceId: "xero-1", updatedAt: new Date("2026-11-10T00:00:00Z"), metadata: { xeroExportState: "EXPORTED" },
    lines: [
      { id: A, jobId: null, quantity: 1, unitPrice: 60, lineTotal: 60, category: "SERVICE", sortOrder: 0, shoppingClientChargeId: null, shoppingRunId: null },
      { id: B, jobId: null, quantity: 1, unitPrice: 40, lineTotal: 40, category: "SERVICE", sortOrder: 1, shoppingClientChargeId: null, shoppingRunId: null },
    ],
    ...overrides,
  };
}

const patch = (body: Record<string, unknown>) => patchClientInvoice({ invoiceId: "invoice", body, actor });

beforeEach(() => {
  vi.clearAllMocks();
  m.invoice = invoice();
  m.update.mockImplementation(async ({ data }: any) => ({ ...m.invoice, ...data }));
  m.updateMany.mockResolvedValue({ count: 1 });
});

describe("order only on an invoice in Xero", () => {
  it("re-orders an approved invoice that is in Xero", async () => {
    const result = await patch({ reorderLineIds: [B, A] });
    expect(result.status).toBeLessThan(400);
    expect(m.updateMany.mock.calls.map(([args]) => [args.where.id, args.data.sortOrder])).toEqual([[B, 0], [A, 1]]);
  });

  it("still refuses every amount or content edit, alone or alongside the order", async () => {
    for (const body of [
      { updateLines: [{ id: A, unitPrice: 70 }] },
      { reorderLineIds: [B, A], updateLines: [{ id: A, unitPrice: 70 }] },
      { reorderLineIds: [B, A], gstEnabled: false },
      { reorderLineIds: [B, A], clientNote: "hi" },
      { addLine: { description: "x", quantity: 1, unitPrice: 5 } },
    ]) {
      const result = await patch(body);
      expect(result.status, JSON.stringify(body)).toBe(409);
      expect(result.body.error).toBe(XERO_ISSUED_REFUSAL);
    }
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an order that does not list every line exactly once", async () => {
    for (const ids of [[A], [A, A], [A, "cl00000000000000000000009"]]) {
      const result = await patch({ reorderLineIds: ids });
      expect(result.status).toBe(409);
      expect(result.body.error).toBe(ORDER_ONLY_LINES_REFUSAL);
    }
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a sent, paid or void invoice's order, with the reason in words", async () => {
    for (const overrides of [{ status: "SENT" }, { status: "PAID", paidAt: new Date(), paidAmount: 110 }, { status: "VOID" }]) {
      m.invoice = invoice(overrides);
      const result = await patch({ reorderLineIds: [B, A] });
      expect(result.status, JSON.stringify(overrides)).toBe(409);
      expect(typeof result.body.error).toBe("string");
    }
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("waits while an Update in Xero is running", async () => {
    m.invoice = invoice({ metadata: { xeroExportState: "EXPORTED", xeroUpdate: { state: "PENDING", key: "k-1234567", at: new Date().toISOString() } } });
    const result = await patch({ reorderLineIds: [B, A] });
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/running/);
  });

  it("the order lock the editor reads says the same", () => {
    expect(invoiceOrderLock(invoice())).toEqual({ reorderable: true, orderOnly: true });
    expect(invoiceOrderLock(invoice({ xeroInvoiceId: null }))).toEqual({ reorderable: true, orderOnly: false });
    expect(invoiceOrderLock(invoice({ status: "SENT" }))).toMatchObject({ reorderable: false });
    expect(invoiceOrderLock(invoice({ paidAmount: 10 }))).toMatchObject({ reorderable: false });
  });
});

describe("where Update in Xero is offered", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({ status: "SENT", kind: "INVOICE", xeroInvoiceId: "xero-1", xeroExportedAt: "2026-11-01", paidAt: null, paidAmount: 0, xeroState: "PUSHED", overdue: false, ...overrides }) as any;
  it("only on a row already in Xero with no payment here", () => {
    expect(availableInvoiceActions(row())).toContain("xero-update");
    expect(availableInvoiceActions(row({ xeroInvoiceId: null, xeroExportedAt: null, xeroState: "NONE" }))).not.toContain("xero-update");
    expect(availableInvoiceActions(row({ status: "PART_PAID", paidAmount: 10 }))).not.toContain("xero-update");
    expect(availableInvoiceActions(row({ status: "PAID", paidAt: "2026-11-02" }))).not.toContain("xero-update");
    expect(availableInvoiceActions(row({ status: "VOID" }))).not.toContain("xero-update");
    expect(availableInvoiceActions(row({ kind: "CREDIT_NOTE", status: "SENT" }))).toContain("xero-update");
  });
  it("explains why not, in words", () => {
    expect(xeroUpdateAvailability(row({ status: "PAID", paidAt: "2026-11-02" }))).toEqual({ available: false, reason: expect.stringMatching(/payment/) });
    expect(xeroUpdateAvailability(row(), false)).toEqual({ available: false, reason: "Your access to invoices is view only." });
  });
});

describe("reading Xero's lines and comparing", () => {
  const raw = (lineItems: unknown) => ({ InvoiceID: "x", Status: "DRAFT", Total: 110, AmountDue: 110, LineItems: lineItems });
  it("reads lines when every one is readable, never guesses otherwise", () => {
    const ok = parseXeroDocument(raw([{ Description: "A", Quantity: 1, UnitAmount: 60 }]), "ACCREC");
    expect(ok.ok && ok.document.lineItems).toEqual([{ description: "A", quantity: 1, unitAmount: 60 }]);
    const bad = parseXeroDocument(raw([{ Description: "A", Quantity: 1 }]), "ACCREC");
    expect(bad.ok && bad.document.lineItems).toBeNull();
    const none = parseXeroDocument(raw(undefined), "ACCREC");
    expect(none.ok && none.document.lineItems).toBeNull();
  });
  it("classifies the change", () => {
    const a = { description: "A", quantity: 1, unitAmount: 60 };
    const b = { description: "B", quantity: 1, unitAmount: 40 };
    expect(compareXeroLines([a, b], [a, b])).toBe("none");
    expect(compareXeroLines([a, b], [b, a])).toBe("order-only");
    expect(compareXeroLines([a, b], [{ ...b, description: "Bondi - B" }, a])).toBe("descriptions");
    expect(compareXeroLines([a, b], [a, { ...b, unitAmount: 41 }])).toBe("amounts");
    expect(compareXeroLines(null, [a])).toBe("unknown");
  });
});

describe("the Xero transport for Update in Xero", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", m.fetch);
    m.connection.mockResolvedValue({ tenantId: "tenant", accessToken: "test-token", expiresAt: new Date(Date.now() + 3_600_000) });
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ Invoices: [{ InvoiceID: "XERO-1", Status: "AUTHORISED", Total: 110 }] }) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const send = (kind: "ACCREC" | "ACCRECCREDIT" = "ACCREC") =>
    updateClientDocumentInXero({ kind, xeroId: "xero-1", idempotencyKey: "client-invoice-update-inv-k", lineItems: [{ description: "A", quantity: 1, unitAmount: 60, accountCode: "4000" }], gstEnabled: true });

  it("POSTs to the existing document only, with its key, and never sends status, contact or a create", async () => {
    const result = await send();
    expect(result).toEqual({ id: "XERO-1", status: "AUTHORISED", total: 110 });
    const [url, request] = m.fetch.mock.calls[0];
    expect(url).toBe("https://api.xero.com/api.xro/2.0/Invoices/xero-1");
    expect(request.method).toBe("POST");
    expect(request.headers["Idempotency-Key"]).toBe("client-invoice-update-inv-k");
    const body = JSON.parse(request.body).Invoices[0];
    expect(body).toMatchObject({ InvoiceID: "xero-1", LineAmountTypes: "Exclusive" });
    expect(body).not.toHaveProperty("Status");
    expect(body).not.toHaveProperty("Contact");
    expect(body).not.toHaveProperty("Type");
    expect(body.LineItems[0]).not.toHaveProperty("LineItemID");
  });

  it("a credit note goes to its own CreditNotes id", async () => {
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ CreditNotes: [{ CreditNoteID: "xero-1", Status: "DRAFT", Total: 60 }] }) });
    await send("ACCRECCREDIT");
    expect(m.fetch.mock.calls[0][0]).toBe("https://api.xero.com/api.xro/2.0/CreditNotes/xero-1");
    expect(JSON.parse(m.fetch.mock.calls[0][1].body).CreditNotes[0]).toMatchObject({ CreditNoteID: "xero-1" });
  });

  it("refuses an answer about any other document", async () => {
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ Invoices: [{ InvoiceID: "another" }] }) });
    await expect(send()).rejects.toThrow(/did not confirm/);
  });

  it("keeps Xero's words when it refuses", async () => {
    m.fetch.mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ Elements: [{ ValidationErrors: [{ Message: "This document cannot be edited as it has a payment or credit note allocated to it." }] }] }) });
    await expect(send()).rejects.toThrow("This document cannot be edited as it has a payment or credit note allocated to it.");
  });
});
