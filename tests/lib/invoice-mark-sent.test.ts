// @vitest-environment node
/**
 * Parity audit 2026-11-12: "Mark as sent (not emailed)" is a PATCH { status:
 * "SENT" } through the existing invoice action. It must keep every rule of the
 * status path (leave-draft checks, terms and first-sent snapshot) and leave an
 * audit row saying it was marked sent without email; a refused move writes no
 * audit row and changes nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  invoice: null as any,
  jobs: [] as any[],
  update: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
}));

function store() {
  return {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    clientInvoice: { findUnique: vi.fn(async () => m.invoice), update: m.update, findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    clientInvoiceLine: {
      findMany: vi.fn(async (args: any) => (args?.select?.invoice ? [] : m.invoice.lines)),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    client: { findUnique: vi.fn(async () => ({ paymentTermsDays: 7 })) },
    job: { findMany: vi.fn(async () => m.jobs) },
    propertyClientRate: { findMany: vi.fn(async () => []) },
    priceBook: { findMany: vi.fn(async () => []) },
    property: { findMany: vi.fn(async () => []) },
    auditLog: { create: m.audit },
  };
}

vi.mock("@/lib/db", () => {
  const db: any = {};
  db.$transaction = async (work: any) => work(Object.assign(store(), { $transaction: db.$transaction }));
  return { db };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Test", invoicing: { defaultPaymentTermsDays: 14 } }) }));

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { describeInvoiceAudit } from "@/lib/billing/client-invoice-history";

const LINE_ID = "cl00000000000000000000001";
const version = new Date("2026-10-15T01:00:00Z");
const actor = { id: "ops", role: "OPS_MANAGER" };

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice",
    kind: "INVOICE",
    invoiceNumber: "INV-1",
    status: "APPROVED",
    clientId: "client",
    subtotal: 50,
    gstAmount: 5,
    totalAmount: 55,
    gstEnabled: true,
    paidAt: null,
    paidAmount: null,
    sentAt: null,
    paymentTermsDays: null,
    xeroInvoiceId: null,
    updatedAt: version,
    metadata: {},
    lines: [{ id: LINE_ID, jobId: "job", quantity: 1, unitPrice: 50, lineTotal: 50, category: "SERVICE", shoppingClientChargeId: null, shoppingRunId: null }],
    ...overrides,
  };
}

function finishedJob() {
  return {
    id: "job", jobNumber: "J1", status: "COMPLETED", updatedAt: version, completedAt: version,
    timeLogs: [], propertyId: "property", property: { clientId: "client" },
    fixedPrice: 50, jobType: "STANDARD_CLEAN", invoiceNote: null, cleanSkipStatus: null,
  };
}

const markSent = () => patchClientInvoice({ invoiceId: "invoice", body: { status: "SENT" }, actor });

beforeEach(() => {
  vi.clearAllMocks();
  m.invoice = invoice();
  m.jobs = [finishedJob()];
  m.update.mockImplementation(async ({ data }: any) => ({ ...m.invoice, ...data }));
});

describe("Mark as sent (not emailed)", () => {
  it("moves an approved invoice to SENT, snapshots terms and first-sent day, and audits it as not emailed", async () => {
    const result = await markSent();
    expect(result.status).toBe(200);
    const data = m.update.mock.calls[0][0].data;
    expect(data.status).toBe("SENT");
    expect(data.sentAt).toBeInstanceOf(Date);
    expect(data.paymentTermsDays).toBe(7);
    const row = m.audit.mock.calls.map((call) => call[0].data).find((entry) => entry.action === "CLIENT_INVOICE_MARKED_SENT");
    expect(row).toMatchObject({
      userId: "ops",
      entity: "ClientInvoice",
      entityId: "invoice",
      before: { status: "APPROVED" },
      after: { status: "SENT", emailed: false, note: "Marked sent without email" },
    });
    expect(describeInvoiceAudit(row.action, row.after)).toBe("Marked sent without email");
    expect(m.email).not.toHaveBeenCalled();
  });

  it("keeps the first-sent day and the terms an invoice already has", async () => {
    m.invoice = invoice({ sentAt: new Date("2026-10-01T00:00:00Z"), paymentTermsDays: 30 });
    await markSent();
    const data = m.update.mock.calls[0][0].data;
    expect(data.sentAt).toBeUndefined();
    expect(data.paymentTermsDays).toBeUndefined();
  });

  it("applies the leave-draft rules to a draft: a job with no rate refuses the move and writes no audit row", async () => {
    m.invoice = invoice({ status: "DRAFT", lines: [{ ...invoice().lines[0], unitPrice: 0, lineTotal: 0 }], subtotal: 0, gstAmount: 0, totalAmount: 0 });
    m.jobs = [{ ...finishedJob(), fixedPrice: null }];
    const result = await markSent();
    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/no client rate/);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit.mock.calls.some((call) => call[0].data.action === "CLIENT_INVOICE_MARKED_SENT")).toBe(false);
  });

  it("refuses a paid invoice (outside the lifecycle) without an audit row", async () => {
    m.invoice = invoice({ status: "PAID", paidAt: version, paidAmount: 55, sentAt: version, paymentTermsDays: 14 });
    const result = await markSent();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(m.audit.mock.calls.some((call) => call[0].data.action === "CLIENT_INVOICE_MARKED_SENT")).toBe(false);
  });
});
