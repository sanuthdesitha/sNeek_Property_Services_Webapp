// @vitest-environment node
/**
 * The "Before you approve" checklist must agree with the approve request: when
 * the checklist says nothing blocks approval, the PATCH approves; when the PATCH
 * refuses, the checklist names the same reason. The editor's read-only reasons
 * must be the PATCH's own refusals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  invoice: null as any,
  jobs: [] as any[],
  rates: [] as any[],
  priceBook: [] as any[],
  otherLines: [] as any[],
  update: vi.fn(),
}));

function store() {
  return {
    $queryRaw: vi.fn(),
    clientInvoice: { findUnique: vi.fn(async () => m.invoice), update: m.update },
    clientInvoiceLine: {
      findMany: vi.fn(async (args: any) => (args?.select?.invoice ? m.otherLines : m.invoice.lines)),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    job: { findMany: vi.fn(async () => m.jobs) },
    propertyClientRate: { findMany: vi.fn(async () => m.rates) },
    priceBook: { findMany: vi.fn(async () => m.priceBook) },
    property: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn() },
  };
}

vi.mock("@/lib/db", () => {
  const db: any = {};
  db.$transaction = async (work: any) => work(Object.assign(store(), { $transaction: db.$transaction }));
  return { db };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Test" }) }));

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { approvalRefusedByChecks, clientInvoiceApprovalChecks } from "@/lib/billing/client-invoice-checks";
import {
  PAYMENT_EVIDENCE_REFUSAL,
  XERO_ISSUED_REFUSAL,
  XERO_RESERVATION_REFUSAL,
  invoiceEditLock,
} from "@/lib/billing/client-invoice-guards";

const LINE_ID = "cl00000000000000000000001";
const version = new Date("2026-10-15T01:00:00Z");
const actor = { id: "admin", role: "ADMIN" };

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: "invoice",
    invoiceNumber: "INV-1",
    status: "DRAFT",
    clientId: "client",
    subtotal: 50,
    gstAmount: 5,
    totalAmount: 55,
    gstEnabled: true,
    paidAt: null,
    paidAmount: null,
    xeroInvoiceId: null,
    metadata: {},
    lines: [{ id: LINE_ID, jobId: "job", quantity: 1, unitPrice: 50, lineTotal: 50, category: "SERVICE", shoppingClientChargeId: null, shoppingRunId: null }],
    ...overrides,
  };
}

function startedJob() {
  return {
    id: "job", jobNumber: "J1", status: "IN_PROGRESS", updatedAt: version, completedAt: null,
    timeLogs: [{ startedAt: version, stoppedAt: null }], propertyId: "property", property: { clientId: "client" },
    fixedPrice: 50, jobType: "STANDARD_CLEAN", invoiceNote: null, cleanSkipStatus: null,
  };
}

function review(required: boolean) {
  return {
    startedWorkReview: {
      version: 1, required, periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-10-15T23:59:59Z",
      jobs: [{ jobId: "job", updatedAt: version.toISOString(), agreedAmount: 50, unfinishedAtCutoff: true }],
    },
  };
}

async function approve() {
  return patchClientInvoice({ invoiceId: "invoice", body: { status: "APPROVED" }, actor });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.invoice = draft();
  m.jobs = [startedJob()];
  m.rates = [];
  m.priceBook = [];
  m.otherLines = [];
  m.update.mockImplementation(async ({ data }: any) => ({ ...m.invoice, ...data }));
});

describe("checklist agrees with the approve request", () => {
  it("passes when approval passes", async () => {
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    expect(checks.appliesTo).toBe("approve");
    expect(approvalRefusedByChecks(checks)).toBe(false);
    expect((await approve()).status).toBe(200);
  });

  it("names the refusal when the started-work review is unresolved", async () => {
    m.invoice = draft({ metadata: review(true) });
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    const item = checks.items.find((check) => check.key === "started-work")!;
    expect(item).toMatchObject({ state: "refused", enforced: true });
    const result = await approve();
    expect(result.status).toBe(400);
    expect(result.body.error).toBe(item.detail);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("names the refusal when the job changed after a confirmed review", async () => {
    m.invoice = draft({ metadata: review(false) });
    m.jobs = [{ ...startedJob(), fixedPrice: 70 }];
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    const item = checks.items.find((check) => check.key === "started-work")!;
    expect(item.state).toBe("refused");
    const result = await approve();
    expect(result.status).toBe(400);
    expect(result.body.error).toBe(item.detail);
  });

  it("reports a confirmed, unchanged review as passing, and approval passes", async () => {
    m.invoice = draft({ metadata: review(false) });
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    expect(approvalRefusedByChecks(checks)).toBe(false);
    expect((await approve()).status).toBe(200);
  });

  it("treats an unreadable started-work snapshot as refused, as approval does", async () => {
    m.invoice = draft({ metadata: { startedWorkReview: { version: 2, jobs: [] } } });
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    expect(approvalRefusedByChecks(checks)).toBe(true);
    expect((await approve()).status).toBe(400);
  });

  it("lists a pending Xero reservation as blocking, with the PATCH's own refusal", async () => {
    m.invoice = draft({ metadata: { xeroExportState: "PENDING" } });
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    expect(checks.items.find((check) => check.key === "xero-reservation")).toMatchObject({ state: "refused", enforced: true });
    const result = await approve();
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(XERO_RESERVATION_REFUSAL);
  });

  it("shows advisory checks as Check without claiming approval would refuse", async () => {
    m.jobs = [{ ...startedJob(), fixedPrice: null }];
    m.otherLines = [{ jobId: "job", invoice: { invoiceNumber: "INV-0" } }];
    m.invoice = draft({ totalAmount: 99 });
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    const byKey = Object.fromEntries(checks.items.map((check) => [check.key, check]));
    expect(byKey.rates).toMatchObject({ state: "check", enforced: false, detail: "J1" });
    expect(byKey["other-invoice"]).toMatchObject({ state: "check", enforced: false, detail: "INV-0" });
    expect(byKey.totals).toMatchObject({ state: "check", enforced: false });
    expect(approvalRefusedByChecks(checks)).toBe(false);
    expect((await approve()).status).toBe(200);
  });

  it("never shows OK when a check cannot be read", async () => {
    const client = store();
    client.job.findMany.mockRejectedValue(new Error("database offline"));
    client.clientInvoiceLine.findMany.mockRejectedValue(new Error("database offline"));
    const checks = await clientInvoiceApprovalChecks(m.invoice, client as any);
    const byKey = Object.fromEntries(checks.items.map((check) => [check.key, check]));
    expect(byKey.rates.state).toBe("unknown");
    expect(byKey["other-invoice"].state).toBe("unknown");
  });

  it("offers advisory checks only once past approval", async () => {
    m.invoice = draft({ status: "APPROVED", metadata: review(true) });
    const checks = await clientInvoiceApprovalChecks(m.invoice, store() as any);
    expect(checks.appliesTo).toBeNull();
    expect(checks.items.map((check) => check.key)).toEqual(["rates", "other-invoice", "totals"]);
  });
});

describe("read-only reasons are the PATCH's refusals", () => {
  const edit = () => patchClientInvoice({ invoiceId: "invoice", body: { updateLines: [{ id: LINE_ID, description: "Changed" }] }, actor });

  it.each([
    [{ xeroInvoiceId: "remote" }, XERO_ISSUED_REFUSAL, "xero-issued"],
    [{ paidAmount: 10 }, PAYMENT_EVIDENCE_REFUSAL, "payment"],
    [{ metadata: { xeroExportState: "PENDING" } }, XERO_RESERVATION_REFUSAL, "xero-pending"],
  ] as const)("%j", async (fields, message, kind) => {
    m.invoice = draft(fields as Record<string, unknown>);
    expect(invoiceEditLock(m.invoice, true)).toEqual({ editable: false, kind, reason: message });
    const result = await edit();
    expect(result.status).toBe(409);
    expect(result.body.error).toBe(message);
  });

  it("states void, issued and view-only reasons, and allows editing a draft or approved invoice", () => {
    expect(invoiceEditLock(draft({ status: "VOID" }), true)).toMatchObject({ editable: false, kind: "void" });
    expect(invoiceEditLock(draft({ status: "SENT" }), true)).toMatchObject({ editable: false, kind: "issued" });
    expect(invoiceEditLock(draft(), false)).toMatchObject({ editable: false, kind: "view-only" });
    expect(invoiceEditLock(draft(), true)).toEqual({ editable: true });
    expect(invoiceEditLock(draft({ status: "APPROVED" }), true)).toEqual({ editable: true });
  });
});
