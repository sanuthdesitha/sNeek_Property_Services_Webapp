// @vitest-environment node
/**
 * Xero push (credit notes as ACCRECCREDIT, PO in the reference, audit rows) and
 * the send action (client-facing link, audit rows, credit-note limit, empty
 * refusal). Xero is mocked: no credentials exist in this environment, so the
 * real provider call is NOT exercised here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  invoice: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  pushInvoice: vi.fn(),
  pushCredit: vi.fn(),
  settings: vi.fn(),
  getInvoice: vi.fn(),
  pdf: vi.fn(),
  email: vi.fn(),
  template: vi.fn(),
  limitFind: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const client = () => ({
    $queryRaw: vi.fn(),
    clientInvoice: { findUnique: m.invoice, update: m.update },
    auditLog: { create: m.audit },
    notification: { create: vi.fn() },
    client: { update: vi.fn() },
  });
  return { db: { ...client(), $transaction: async (work: (tx: unknown) => unknown) => work(client()) } };
});
vi.mock("@/lib/xero/client", () => ({ pushClientInvoiceToXero: m.pushInvoice, pushClientCreditNoteToXero: m.pushCredit }));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: m.settings }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: m.getInvoice, renderClientInvoicePdf: m.pdf }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Co" }) }));
vi.mock("@/lib/commercial/delivery-profiles", () => ({ resolveClientDeliveryRecipients: async () => ["client@example.test"] }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: m.template }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: vi.fn() }));

import { pushClientInvoiceToXeroOnce } from "@/lib/billing/client-invoice-xero";
import { clientInvoiceUrl, sendClientInvoice } from "@/lib/billing/client-invoice-send";

let stored: Record<string, unknown>;
const updatedAt = new Date("2026-11-01T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ xero: { defaultAccountCode: "200", disbursementAccountCode: "800", salesTaxType: "OUTPUT2", defaultItemCode: "" } });
  m.update.mockResolvedValue({});
  m.audit.mockResolvedValue({});
  m.pushInvoice.mockResolvedValue({ xeroInvoiceId: "xero-inv", contactId: "contact" });
  m.pushCredit.mockResolvedValue({ xeroCreditNoteId: "xero-cn", contactId: "contact" });
  stored = {
    id: "inv", kind: "INVOICE", status: "SENT", invoiceNumber: "INV-1", gstEnabled: true, createdAt: new Date("2026-10-20T00:00:00Z"), updatedAt,
    periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-15T00:00:00Z"), clientReference: "PO-9", clientId: "c1",
    xeroInvoiceId: null, metadata: null, client: { name: "Client", email: "c@example.test", xeroContactId: "contact" }, creditsInvoice: null,
    lines: [
      { description: "Clean", quantity: 1, unitPrice: 200, lineTotal: 200, category: "SERVICE", note: null, job: null },
      { description: "Discount", quantity: 1, unitPrice: -20, lineTotal: -20, category: "DISCOUNT", note: null, job: null },
    ],
  };
  m.invoice.mockImplementation(async () => stored);
  m.template.mockReturnValue({ subject: "Invoice", html: "<p>hi</p>" });
  m.pdf.mockResolvedValue(Buffer.from("pdf"));
  m.email.mockResolvedValue({ ok: true });
});

describe("Xero push", () => {
  it("keeps the invoice idempotency key, puts the PO first and sends the discount as a negative line", async () => {
    const result = await pushClientInvoiceToXeroOnce("inv", "admin");
    expect(result.status).toBe(200);
    const payload = m.pushInvoice.mock.calls[0][0];
    expect(payload.idempotencyKey).toBe("client-invoice-inv");
    expect(payload.reference).toBe("PO-9 · Service period 2026-10-01 – 2026-10-15");
    expect(payload.lineItems[1]).toMatchObject({ unitAmount: -20, accountCode: "200" });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "admin", action: "CLIENT_INVOICE_XERO_PUSH", entityId: "inv", after: expect.objectContaining({ outcome: "pushed" }) }) });
  });

  it("creates an issued credit note as an ACCRECCREDIT credit note with positive amounts", async () => {
    Object.assign(stored, {
      kind: "CREDIT_NOTE", status: "APPROVED", invoiceNumber: "CN-1", clientReference: null, creditsInvoice: { invoiceNumber: "INV-1" },
      lines: [{ description: "Clean", quantity: 1, unitPrice: -200, lineTotal: -200, category: "SERVICE", note: null, job: null }],
    });
    const result = await pushClientInvoiceToXeroOnce("inv", "admin");
    expect(result.body).toMatchObject({ ok: true, xeroInvoiceId: "xero-cn" });
    expect(m.pushInvoice).not.toHaveBeenCalled();
    expect(m.pushCredit).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "client-credit-note-inv",
      creditNoteNumber: "CN-1",
      reference: "Credit for INV-1",
      lineItems: [expect.objectContaining({ unitAmount: 200, accountCode: "200" })],
    }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ xeroInvoiceId: "xero-cn" }) }));
  });

  it("refuses a draft credit note and an invoice with no lines, before any provider call", async () => {
    Object.assign(stored, { kind: "CREDIT_NOTE", status: "DRAFT" });
    expect((await pushClientInvoiceToXeroOnce("inv", "admin")).status).toBe(409);
    Object.assign(stored, { kind: "INVOICE", status: "DRAFT", lines: [] });
    expect((await pushClientInvoiceToXeroOnce("inv", "admin")).status).toBe(409);
    expect(m.pushInvoice).not.toHaveBeenCalled();
    expect(m.pushCredit).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenLastCalledWith({ data: expect.objectContaining({ after: expect.objectContaining({ outcome: "failed" }) }) });
  });
});

describe("send", () => {
  beforeEach(() => {
    m.getInvoice.mockImplementation(async () => ({ ...stored, status: "APPROVED", totalAmount: 198 }));
  });

  it("links the client to the client portal invoice page and records an audit row without the email body", async () => {
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "https://app.test", actorId: "admin" });
    expect(result.status).toBe(200);
    expect(m.template.mock.calls[0][2]).toMatchObject({ actionUrl: "https://app.test/v2/client/finance/invoices/inv" });
    expect(clientInvoiceUrl("https://app.test", "a b")).toBe("https://app.test/v2/client/finance/invoices/a%20b");
    const audit = m.audit.mock.calls[0][0].data;
    expect(audit).toMatchObject({ userId: "admin", action: "CLIENT_INVOICE_SENT", entityId: "inv", after: { outcome: "sent", recipientCount: 1 } });
    expect(JSON.stringify(audit)).not.toContain("<p>");
    expect(JSON.stringify(audit)).not.toContain("client@example.test");
  });

  it("records a provider failure as failed, not sent", async () => {
    m.email.mockResolvedValue({ ok: false, error: "bounced" });
    expect((await sendClientInvoice({ invoiceId: "inv", origin: "https://app.test", actorId: "admin" })).status).toBe(502);
    expect(m.audit.mock.calls[0][0].data.after).toMatchObject({ outcome: "failed", error: "bounced" });
  });

  it("refuses to send an empty invoice and a draft credit note above its limit", async () => {
    m.getInvoice.mockResolvedValueOnce({ ...stored, status: "DRAFT", lines: [] });
    expect((await sendClientInvoice({ invoiceId: "inv", origin: "o", actorId: "admin" })).status).toBe(409);
    m.getInvoice.mockResolvedValueOnce({ ...stored, kind: "CREDIT_NOTE", creditsInvoiceId: "orig", status: "DRAFT", totalAmount: -300 });
    m.invoice.mockResolvedValueOnce({ invoiceNumber: "INV-1", totalAmount: 220, creditNotes: [] });
    const refused = await sendClientInvoice({ invoiceId: "inv", origin: "o", actorId: "admin" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/more than INV-1/);
    expect(m.email).not.toHaveBeenCalled();
  });
});
