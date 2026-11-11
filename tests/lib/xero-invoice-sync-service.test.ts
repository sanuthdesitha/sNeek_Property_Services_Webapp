// @vitest-environment node
/**
 * Money step (d): the Xero status pull service with a mocked Xero client and a
 * mocked payment path. Nothing here is exercised against real Xero.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  connected: vi.fn(),
  readInvoices: vi.fn(),
  readCredit: vi.fn(),
  patch: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  lock: vi.fn(),
  user: vi.fn(),
  audit: vi.fn(),
  settingFind: vi.fn(),
  settingUpsert: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: m.info, error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/xero/client", () => ({
  XERO_READ_BATCH_SIZE: 2,
  hasActiveXeroConnection: m.connected,
  readXeroInvoices: m.readInvoices,
  readXeroCreditNote: m.readCredit,
}));
vi.mock("@/lib/billing/client-invoice-patch", () => ({ patchClientInvoice: m.patch, XERO_PAYMENT_EXCEEDS_OWING: "XERO_PAYMENT_EXCEEDS_OWING" }));
vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: m.lock, clientInvoice: { findUnique: m.findUnique, update: m.update } };
  return {
    db: {
      clientInvoice: { findMany: m.findMany, findUnique: m.findUnique, count: m.count, update: m.update },
      user: { findFirst: m.user },
      auditLog: { create: m.audit },
      appSetting: { findUnique: m.settingFind, upsert: m.settingUpsert },
      $transaction: async (work: (client: unknown) => unknown) => work(tx),
    },
  };
});

import { refreshInvoicesFromXero, runScheduledXeroSync, XERO_SYNC_MAX_INVOICES_PER_RUN } from "@/lib/billing/client-invoice-xero-sync";

type Row = Record<string, unknown> & { id: string; metadata: unknown; status: string };
let rows: Map<string, Row>;
const invoice = (id: string, extra: Partial<Row> = {}): Row => ({
  id, invoiceNumber: `INV-${id}`, kind: "INVOICE", status: "SENT", xeroInvoiceId: `x-${id}`, totalAmount: 110, paidAmount: 0, metadata: null, creditNotes: [], ...extra,
});
const xdoc = (id: string, extra: Record<string, unknown> = {}) => ({
  ok: true as const,
  document: { id, kind: "ACCREC", status: "AUTHORISED", total: 110, amountDue: 110, amountPaid: 0, amountCredited: 0, payments: [], hasOverOrPrepayments: false, updatedAt: null, ...extra },
});
const admin = { id: "admin", role: "ADMIN", name: "Ann" };
const stored = (id: string) => (rows.get(id)!.metadata as { xeroSync?: Record<string, unknown> } | null)?.xeroSync;

beforeEach(() => {
  vi.clearAllMocks();
  rows = new Map();
  m.connected.mockResolvedValue(true);
  m.user.mockResolvedValue({ id: "sys", role: "ADMIN", name: "Owner", email: null });
  m.count.mockImplementation(async () => Array.from(rows.values()).filter((r) => r.kind === "INVOICE").length);
  m.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    const all = Array.from(rows.values());
    if ((where.id as { in?: string[] } | undefined)?.in) return all.filter((r) => (where.id as { in: string[] }).in.includes(r.id));
    return all.filter((r) => r.kind === where.kind);
  });
  m.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null);
  m.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = rows.get(where.id)!;
    rows.set(where.id, { ...row, ...data });
    return rows.get(where.id);
  });
  m.patch.mockImplementation(async ({ invoiceId, body }: { invoiceId: string; body: { recordPayment: { amount: number } } }) => {
    const row = rows.get(invoiceId)!;
    const paid = Number(row.paidAmount) + body.recordPayment.amount;
    rows.set(invoiceId, { ...row, paidAmount: paid, status: paid + 0.005 >= Number(row.totalAmount) ? "PAID" : "PART_PAID" });
    return { status: 200, body: {} };
  });
  m.settingFind.mockResolvedValue(null);
  m.audit.mockResolvedValue({});
});

describe("scheduled run", () => {
  it("is a no-op with a clear log when Xero is not connected", async () => {
    m.connected.mockResolvedValue(false);
    rows.set("a", invoice("a"));
    const summary = await runScheduledXeroSync();
    expect(summary.skipped).toBe("not-connected");
    expect(m.info).toHaveBeenCalledWith(expect.stringContaining("not connected"));
    expect(m.readInvoices).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.settingUpsert).not.toHaveBeenCalled();
  });

  it("records each new Xero payment through the payment path with method XERO and the payment id as key, then PAID_IN_XERO", async () => {
    rows.set("a", invoice("a"));
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a", { status: "PAID", amountDue: 0, amountPaid: 110, payments: [
      { paymentId: "p2", date: "2026-11-09", amount: 60, status: "AUTHORISED", reference: "Bank" },
      { paymentId: "p1", date: "2026-11-01", amount: 50, status: "AUTHORISED", reference: null },
    ] })]]));
    const summary = await runScheduledXeroSync({ now: new Date("2026-11-11T00:20:00Z") });
    expect(m.patch.mock.calls.map(([call]) => [call.xeroPayment.paymentId, call.body.recordPayment.method, call.body.recordPayment.paidDate, call.actor.id, call.xeroPayment.trigger]))
      .toEqual([["p1", "XERO", "2026-11-01", "sys", "scheduled"], ["p2", "XERO", "2026-11-09", "sys", "scheduled"]]);
    expect(summary.results[0]).toMatchObject({ outcome: "recorded", paymentsRecorded: 2, state: "PAID_IN_XERO" });
    expect(stored("a")).toMatchObject({ state: "PAID_IN_XERO", xeroStatus: "PAID", lastReadAt: "2026-11-11T00:20:00.000Z" });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_INVOICE_XERO_SYNC", entityId: "a", after: expect.objectContaining({ trigger: "scheduled", paymentsRecorded: 2 }) }) });
    expect(m.settingUpsert.mock.calls[0][0].update.value).toMatchObject({ lastSuccessAt: "2026-11-11T00:20:00.000Z" });
  });

  it("re-runs idempotently: an already-recorded payment id is not sent again", async () => {
    rows.set("a", invoice("a", { paidAmount: 50, status: "PART_PAID", metadata: { payments: [{ xeroPaymentId: "p1", amount: 50 }] } }));
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a", { payments: [{ paymentId: "p1", date: "2026-11-01", amount: 50, status: "AUTHORISED", reference: null }] })]]));
    const summary = await runScheduledXeroSync();
    expect(m.patch).not.toHaveBeenCalled();
    expect(summary.results[0].outcome).toBe("in-xero");
  });

  it("a failed read changes nothing on the invoice except recording UNKNOWN with the reason, and is not a successful run", async () => {
    rows.set("a", invoice("a", { metadata: { payments: [], xeroSync: { state: "IN_XERO", checkedAt: "2026-11-10T00:00:00Z", lastReadAt: "2026-11-10T00:00:00Z", xeroStatus: "AUTHORISED" } } }));
    m.settingFind.mockResolvedValue({ value: { lastSuccessAt: "2026-11-10T00:00:00Z" } });
    m.readInvoices.mockResolvedValue(new Map([["x-a", { ok: false, failure: { kind: "rate-limited", reason: "Xero's rate limit was reached." } }]]));
    const summary = await runScheduledXeroSync();
    expect(m.patch).not.toHaveBeenCalled();
    expect(rows.get("a")).toMatchObject({ status: "SENT", paidAmount: 0 });
    expect(stored("a")).toMatchObject({ state: "UNKNOWN", reason: expect.stringContaining("Xero state unknown"), lastReadAt: "2026-11-10T00:00:00Z" });
    expect(summary.counts.unknown).toBe(1);
    expect(m.settingUpsert.mock.calls[0][0].update.value.lastSuccessAt).toBe("2026-11-10T00:00:00Z");
  });

  it.each([
    [{ status: "VOIDED" }, "voided"],
    [{ total: 99 }, "Totals differ"],
  ])("records a discrepancy for review and never edits: %j", async (extra, words) => {
    rows.set("a", invoice("a"));
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a", extra)]]));
    const summary = await runScheduledXeroSync();
    expect(summary.results[0].outcome).toBe("needs-review");
    expect(stored("a")).toMatchObject({ state: "NEEDS_REVIEW", reason: expect.stringContaining(words) });
    expect(rows.get("a")).toMatchObject({ status: "SENT", totalAmount: 110 });
    expect(m.patch).not.toHaveBeenCalled();
  });

  it("turns a payment-path refusal (more than owed) into needs review", async () => {
    rows.set("a", invoice("a"));
    m.patch.mockResolvedValue({ status: 409, body: { error: "too much", code: "XERO_PAYMENT_EXCEEDS_OWING" } });
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a", { payments: [{ paymentId: "p1", date: "2026-11-01", amount: 50, status: "AUTHORISED", reference: null }] })]]));
    const summary = await runScheduledXeroSync();
    expect(summary.results[0]).toMatchObject({ outcome: "needs-review", reason: expect.stringContaining("more than this invoice still owes") });
  });

  it("does not record payments when no administrator exists to attribute them to", async () => {
    m.user.mockResolvedValue(null);
    rows.set("a", invoice("a"));
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a", { payments: [{ paymentId: "p1", date: "2026-11-01", amount: 50, status: "AUTHORISED", reference: null }] })]]));
    const summary = await runScheduledXeroSync();
    expect(m.patch).not.toHaveBeenCalled();
    expect(summary.results[0].outcome).toBe("unknown");
  });

  it("batches invoice reads and reads credit notes one by one; a fully allocated credit note is done", async () => {
    rows.set("a", invoice("a")); rows.set("b", invoice("b")); rows.set("c", invoice("c"));
    rows.set("n", invoice("n", { kind: "CREDIT_NOTE", totalAmount: -20 }));
    rows.set("done", invoice("done", { kind: "CREDIT_NOTE", totalAmount: -20, metadata: { xeroSync: { state: "IN_XERO", checkedAt: "x", xeroStatus: "PAID" } } }));
    m.readInvoices.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, xdoc(id)])));
    m.readCredit.mockResolvedValue({ ok: true, document: { id: "x-n", kind: "ACCRECCREDIT", status: "AUTHORISED", total: 20, amountDue: 20, amountPaid: 0, amountCredited: 0, payments: [], hasOverOrPrepayments: false, updatedAt: null } });
    const summary = await runScheduledXeroSync();
    expect(m.readInvoices.mock.calls.map(([ids]) => ids)).toEqual([["x-a", "x-b"], ["x-c"]]);
    expect(m.readCredit.mock.calls).toEqual([["x-n", {}]]);
    expect(summary.results.map((r) => r.id)).toEqual(["a", "b", "c", "n"]);
    expect(m.patch).not.toHaveBeenCalled();
  });

  it("bounds the work per run (take) and selects only unpaid, unvoided invoices in Xero", async () => {
    m.readInvoices.mockResolvedValue(new Map());
    await runScheduledXeroSync();
    const invoiceQuery = m.findMany.mock.calls.find(([args]) => args.where.kind === "INVOICE")![0];
    expect(invoiceQuery.take).toBe(XERO_SYNC_MAX_INVOICES_PER_RUN);
    expect(invoiceQuery.where).toMatchObject({ xeroInvoiceId: { not: null }, status: { notIn: ["PAID", "VOID"] } });
  });
});

describe("manual refresh", () => {
  it("answers per row, never downgrades a paid invoice and skips what is not in Xero", async () => {
    rows.set("paid", invoice("paid", { status: "PAID", paidAmount: 110 }));
    rows.set("draft", invoice("draft", { xeroInvoiceId: null }));
    rows.set("a", invoice("a"));
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a")]]));
    const summary = await refreshInvoicesFromXero({ ids: ["paid", "draft", "a", "missing"], actor: admin });
    expect(summary.results.map((r) => [r.id, r.outcome])).toEqual([["paid", "skipped"], ["draft", "skipped"], ["a", "in-xero"], ["missing", "skipped"]]);
    expect(rows.get("paid")).toMatchObject({ status: "PAID", metadata: null });
    expect(m.readInvoices.mock.calls[0][0]).toEqual(["x-a"]);
    expect(m.settingUpsert).not.toHaveBeenCalled();
  });

  it("uses the person as the actor and reports not-connected without reading", async () => {
    rows.set("a", invoice("a"));
    m.connected.mockResolvedValue(false);
    const summary = await refreshInvoicesFromXero({ ids: ["a"], actor: admin });
    expect(summary).toMatchObject({ skipped: "not-connected", results: [{ outcome: "skipped" }] });
    expect(m.readInvoices).not.toHaveBeenCalled();
    m.connected.mockResolvedValue(true);
    m.readInvoices.mockResolvedValue(new Map([["x-a", xdoc("x-a", { payments: [{ paymentId: "p1", date: "2026-11-01", amount: 10, status: "AUTHORISED", reference: null }] })]]));
    await refreshInvoicesFromXero({ ids: ["a"], actor: admin });
    expect(m.patch.mock.calls[0][0]).toMatchObject({ actor: admin, xeroPayment: { paymentId: "p1", trigger: "manual" } });
  });
});
