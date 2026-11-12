// @vitest-environment node
/**
 * History (bulk rows per invoice, send/Xero/credit-note labels), the tolerant
 * started-work read, the outstanding/overdue queries with credit notes, and the
 * client payment route charging what is owed after credits.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  audit: vi.fn(),
  auditMany: vi.fn(),
  userFind: vi.fn(),
  paymentCreate: vi.fn(),
  patch: vi.fn(),
  intent: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    clientInvoice: { findMany: m.findMany, findFirst: m.findFirst },
    auditLog: { create: m.audit, createMany: m.auditMany },
    user: { findUnique: m.userFind },
    clientPayment: { create: m.paymentCreate },
  },
}));
vi.mock("@/lib/billing/client-invoice-patch", () => ({ patchClientInvoice: m.patch }));
vi.mock("@/lib/billing/client-invoice-send", () => ({ sendClientInvoice: vi.fn() }));
vi.mock("@/lib/billing/client-invoice-xero", () => ({ pushClientInvoiceToXeroOnce: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "client-user", role: "CLIENT" } }) }));
vi.mock("@/lib/client/portal", () => ({ getClientPortalContext: async () => ({ visibility: {} }) }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: () => true }));
vi.mock("@/lib/app-url", () => ({ getAppBaseUrl: () => "https://app.test" }));
vi.mock("@/lib/payments/service", () => ({
  getPrimaryGateway: async () => ({ id: "g", provider: "STRIPE" }),
  createPaymentAdapter: () => ({ createPaymentIntent: m.intent }),
}));

import { runClientInvoiceBulk } from "@/lib/billing/client-invoice-bulk";
import { describeInvoiceAudit } from "@/lib/billing/client-invoice-history";
import { inspectStartedWorkReview } from "@/lib/billing/started-work-reconciliation";
import { startedWorkCheck } from "@/lib/billing/client-invoice-checks";
import { getOutstandingReceivables } from "@/lib/finance/receivables";
import { overdueWhere } from "@/lib/billing/client-invoice-list";
import { POST as pay } from "@/app/api/client/invoices/[id]/pay/route";

beforeEach(() => {
  vi.clearAllMocks();
  m.audit.mockResolvedValue({});
  m.auditMany.mockResolvedValue({ count: 2 });
});

describe("bulk actions appear in each invoice's history", () => {
  it("keeps the one request row and writes a row per affected invoice", async () => {
    m.findMany.mockResolvedValue([
      { id: "a", invoiceNumber: "INV-1", status: "DRAFT" },
      { id: "b", invoiceNumber: "INV-2", status: "DRAFT" },
    ]);
    m.patch.mockImplementation(async ({ invoiceId }: { invoiceId: string }) =>
      invoiceId === "a" ? { status: 200, body: { status: "APPROVED" } } : { status: 409, body: { error: "No lines" } });
    await runClientInvoiceBulk({ request: { action: "approve", ids: ["a", "b"] } as never, actor: { id: "admin", role: "ADMIN" }, origin: "o" });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_INVOICE_BULK_ACTION", entityId: "bulk" }) });
    const rows = m.auditMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ action: "CLIENT_INVOICE_BULK_ROW", entityId: "a", after: expect.objectContaining({ action: "approve", outcome: "done" }) }),
      expect.objectContaining({ action: "CLIENT_INVOICE_BULK_ROW", entityId: "b", after: expect.objectContaining({ outcome: "refused", reason: "No lines" }) }),
    ]);
  });

  it("labels the new history rows in plain words", () => {
    expect(describeInvoiceAudit("CLIENT_INVOICE_BULK_ROW", { action: "approve", outcome: "refused", reason: "No lines" })).toBe("Bulk approve: refused (No lines)");
    expect(describeInvoiceAudit("CLIENT_INVOICE_SENT", { outcome: "sent" })).toBe("Sent to the client by email");
    expect(describeInvoiceAudit("CLIENT_INVOICE_XERO_PUSH", { outcome: "failed", error: "No connection" })).toBe("Xero push failed: No connection");
    expect(describeInvoiceAudit("CLIENT_INVOICE_CREDIT_NOTE_CREATED", { creditsInvoiceNumber: "INV-1" })).toBe("Credit note created against INV-1");
  });
});

describe("unreadable started-work snapshot (pre-existing fix)", () => {
  const invoice = { status: "DRAFT", clientId: "c1", metadata: { startedWorkReview: { version: 1, jobs: "bad" } }, lines: [] };

  it("is reported instead of throwing, so the invoice still loads", async () => {
    await expect(inspectStartedWorkReview(invoice, {} as never)).resolves.toMatchObject({ requiresReview: true, unreadable: true, error: expect.stringMatching(/could not be read/) });
  });

  it("still refuses approval: unknown is never OK", async () => {
    const check = await startedWorkCheck({ ...invoice, id: "i", gstEnabled: true, totalAmount: 0 }, {} as never);
    expect(check).toMatchObject({ state: "refused", enforced: true });
  });
});

describe("outstanding and overdue with credit notes", () => {
  it("counts invoices only, reducing owing by approved/sent credits", async () => {
    m.findMany.mockResolvedValue([
      { totalAmount: 220, paidAmount: null, creditNotes: [{ status: "SENT", totalAmount: -220 }] },
      { totalAmount: 100, paidAmount: 20, creditNotes: [{ status: "APPROVED", totalAmount: -30 }] },
    ]);
    expect(await getOutstandingReceivables()).toEqual({ outstandingCount: 1, outstandingAud: 50 });
    expect(m.findMany.mock.calls[0][0].where).toMatchObject({ kind: "INVOICE" });
  });

  it("never lists a credit note or a fully credited invoice as overdue", () => {
    const where = overdueWhere({ timezone: "Australia/Sydney", paymentTermsDays: 14, overdueCreatedBefore: new Date(), pendingXeroIds: [], fullyCreditedIds: ["full"] });
    expect(where).toMatchObject({ kind: "INVOICE", id: { notIn: ["full"] } });
  });
});

describe("client payment route", () => {
  const request = () => pay(new NextRequest("https://app.test/api/client/invoices/i/pay", { method: "POST", body: JSON.stringify({ returnUrl: "https://app.test/back" }) }), { params: { id: "i" } });

  beforeEach(() => {
    m.userFind.mockResolvedValue({ clientId: "c1" });
    m.intent.mockResolvedValue({ ok: true, paymentId: "p" });
    m.paymentCreate.mockResolvedValue({});
  });

  it("refuses to take payment for a credit note", async () => {
    m.findFirst.mockResolvedValue({ id: "i", kind: "CREDIT_NOTE", status: "SENT", totalAmount: -50, paidAmount: null, client: {} });
    expect((await request()).status).toBe(400);
    expect(m.intent).not.toHaveBeenCalled();
  });

  it("charges what is owed after approved/sent credit notes", async () => {
    m.findFirst.mockResolvedValue({ id: "i", kind: "INVOICE", status: "SENT", totalAmount: 220, paidAmount: 20, invoiceNumber: "INV-1", client: { name: "C" } });
    m.findMany.mockResolvedValue([{ status: "SENT", totalAmount: -100 }]);
    expect((await request()).status).toBe(200);
    expect(m.intent).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000 }));
    // The attempt row records the amount charged, not the invoice total (fixed 2026-11-11).
    expect(m.paymentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 100 }) });
  });

  it("refuses when credits leave nothing owed", async () => {
    m.findFirst.mockResolvedValue({ id: "i", kind: "INVOICE", status: "SENT", totalAmount: 220, paidAmount: null, client: {} });
    m.findMany.mockResolvedValue([{ status: "SENT", totalAmount: -220 }]);
    expect((await request()).status).toBe(400);
    expect(m.intent).not.toHaveBeenCalled();
  });
});
