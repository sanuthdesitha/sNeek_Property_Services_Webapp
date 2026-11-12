// @vitest-environment node
/**
 * Send options (Wave D): defaults are today's behaviour; "Include payment
 * link" adds the portal link only when the existing pay route could work and
 * is refused (nothing sent) otherwise; "Push to Xero when sent" runs the
 * existing push after a successful send, and a push failure never fails or
 * rolls back the send. Sending a DRAFT runs the approval rules. Xero, email
 * and payments are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  email: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  push: vi.fn(),
  link: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const client = () => ({
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    clientInvoice: {
      findUniqueOrThrow: async () => ({ clientId: "c1", status: "APPROVED", kind: "INVOICE", creditsInvoiceId: null, sentAt: null, paymentTermsDays: 14, metadata: {} }),
      update: m.update,
    },
    clientInvoiceLine: { findMany: vi.fn(async () => []) },
    client: { findUnique: async () => ({ paymentTermsDays: null }) },
    auditLog: { create: m.audit },
    notification: { create: vi.fn() },
  });
  return { db: { ...client(), $transaction: async (work: (tx: unknown) => unknown) => work(client()) } };
});
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: m.getInvoice, renderClientInvoicePdf: async () => Buffer.from("%PDF") }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Co", invoicing: {} }) }));
vi.mock("@/lib/commercial/delivery-profiles", () => ({ resolveClientDeliveryRecipients: async () => ["client@example.test"] }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Invoice", html: "<p>Invoice</p>" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/billing/client-invoice-xero", () => ({ pushClientInvoiceToXeroOnce: m.push }));
vi.mock("@/lib/billing/invoice-payment-link", async (original) => ({ ...(await original<typeof import("@/lib/billing/invoice-payment-link")>()), paymentLinkAvailability: m.link }));

import { sendClientInvoice } from "@/lib/billing/client-invoice-send";

const approved = {
  id: "inv", kind: "INVOICE", status: "APPROVED", invoiceNumber: "INV-1", clientId: "c1", totalAmount: 110, gstEnabled: true,
  metadata: {}, client: { name: "Client", email: "c@example.test" },
  lines: [{ id: "l1", jobId: null, quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getInvoice.mockResolvedValue(approved);
  m.email.mockResolvedValue({ ok: true });
  m.update.mockResolvedValue({});
  m.audit.mockResolvedValue({});
  m.link.mockResolvedValue({ available: true });
});

describe("send options", () => {
  it("keeps today's behaviour without options: no link, no push", async () => {
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "https://app.test", actorId: "admin" });
    expect(result.status).toBe(200);
    expect(m.email.mock.calls[0][0].html).toBe("<p>Invoice</p>");
    expect(m.push).not.toHaveBeenCalled();
  });

  it("adds the portal payment link when the pay route could work", async () => {
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "https://app.test", actorId: "admin", options: { includePaymentLink: true } });
    expect(result.body).toMatchObject({ ok: true, paymentLink: "included" });
    expect(m.email.mock.calls[0][0].html).toContain("https://app.test/v2/client/finance");
  });

  it("refuses a payment link that cannot work, before anything is sent", async () => {
    m.link.mockResolvedValue({ available: false, reason: "No payment gateway is configured: the server has no Stripe key." });
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "o", actorId: "admin", options: { includePaymentLink: true } });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("no Stripe key");
    expect(m.email).not.toHaveBeenCalled();
  });

  it("pushes to Xero after a successful send, and a push failure does not fail the send", async () => {
    m.push.mockResolvedValueOnce({ status: 400, body: { error: "Xero API error (400): bad account" } });
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "o", actorId: "admin", options: { pushToXero: true } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, xeroPush: { outcome: "failed", error: "Xero API error (400): bad account" } });
    expect(m.update).toHaveBeenCalled(); // the send was recorded
    expect(m.audit.mock.calls.some(([args]) => args.data.action === "CLIENT_INVOICE_SEND_OPTIONS" && args.data.after.xeroPush === "failed")).toBe(true);
  });

  it("never pushes when the send itself failed", async () => {
    m.email.mockResolvedValue({ ok: false, error: "bounced" });
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "o", actorId: "admin", options: { pushToXero: true } });
    expect(result.status).toBe(502);
    expect(m.push).not.toHaveBeenCalled();
  });

  it("runs the approval rules when a DRAFT is sent directly", async () => {
    m.getInvoice.mockResolvedValue({ ...approved, status: "DRAFT", totalAmount: 99 });
    const result = await sendClientInvoice({ invoiceId: "inv", origin: "o", actorId: "admin" });
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toContain("The stored total does not match the lines");
    expect(m.email).not.toHaveBeenCalled();
  });
});
