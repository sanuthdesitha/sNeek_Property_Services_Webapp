// @vitest-environment node
/**
 * "Update in Xero" (2026-11-18): re-send an already-pushed invoice's lines, in
 * the PDF's order, to the SAME Xero document. Xero is mocked at the client
 * boundary (readXeroInvoice / readXeroCreditNote / updateClientDocumentInXero);
 * no real Xero call is made.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XeroDocument } from "@/lib/xero/xero-documents";

const m = vi.hoisted(() => ({
  stored: null as any,
  update: vi.fn(),
  audit: vi.fn(),
  readInvoice: vi.fn(),
  readCredit: vi.fn(),
  updateDocument: vi.fn(),
  pushInvoice: vi.fn(),
  pushCredit: vi.fn(),
  settings: vi.fn(),
  session: vi.fn(),
}));

function snapshot() {
  // A fresh copy per read, as the database would return.
  return { ...m.stored, metadata: JSON.parse(JSON.stringify(m.stored.metadata ?? null)), updatedAt: new Date(m.stored.updatedAt) };
}

vi.mock("@/lib/db", () => {
  const client = () => ({
    $queryRaw: vi.fn(),
    clientInvoice: {
      findUnique: vi.fn(async () => (m.stored ? snapshot() : null)),
      update: m.update,
    },
    auditLog: { create: m.audit },
  });
  // Transactions run one at a time, as the row lock (FOR UPDATE) makes them.
  let queue: Promise<unknown> = Promise.resolve();
  const $transaction = (work: (tx: unknown) => unknown) => {
    const next = queue.then(() => work(client()));
    queue = next.catch(() => undefined);
    return next;
  };
  return { db: { ...client(), $transaction } };
});
vi.mock("@/lib/xero/client", () => ({
  readXeroInvoice: m.readInvoice,
  readXeroCreditNote: m.readCredit,
  updateClientDocumentInXero: m.updateDocument,
  pushClientInvoiceToXero: m.pushInvoice,
  pushClientCreditNoteToXero: m.pushCredit,
}));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: m.settings }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));

import { updateClientInvoiceInXero } from "@/lib/billing/client-invoice-xero-update";
import { POST } from "@/app/api/admin/invoices/[id]/xero-update/route";
import { describeInvoiceAudit } from "@/lib/billing/client-invoice-history";

const bondi = { name: "Bondi Flat", suburb: "Bondi" };
const manly = { name: "Manly House", suburb: "Manly" };
const actor = { id: "admin", role: "ADMIN" };

function lines() {
  return [
    { id: "l1", description: "Manly House - TURNOVER - 01 Oct 2026", quantity: 1, unitPrice: 150, lineTotal: 150, category: "SERVICE", note: null, job: { jobType: "TURNOVER", jobNumber: "J1", property: manly }, property: null },
    { id: "l2", description: "Bondi Flat - TURNOVER - 02 Oct 2026", quantity: 1, unitPrice: 120, lineTotal: 120, category: "SERVICE", note: null, job: { jobType: "TURNOVER", jobNumber: "J2", property: bondi }, property: null },
  ];
}

/** What Xero holds after the original (ungrouped) push. */
const XERO_LINES = [
  { description: "Manly House - TURNOVER - 01 Oct 2026 · Job J1", quantity: 1, unitAmount: 150 },
  { description: "Bondi Flat - TURNOVER - 02 Oct 2026 · Job J2", quantity: 1, unitAmount: 120 },
];

function document(overrides: Partial<XeroDocument> = {}): XeroDocument {
  return {
    id: "xero-1", kind: "ACCREC", status: "DRAFT", total: 297, amountDue: 297, amountPaid: 0, amountCredited: 0,
    payments: [], hasOverOrPrepayments: false, updatedAt: null, lineItems: XERO_LINES, ...overrides,
  };
}

function run(overrides: Partial<Parameters<typeof updateClientInvoiceInXero>[0]> = {}) {
  return updateClientInvoiceInXero({ invoiceId: "inv", actor, requestKey: "key-00000001", ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.stored = {
    id: "inv", kind: "INVOICE", status: "APPROVED", invoiceNumber: "INV-1", gstEnabled: true, totalAmount: 297,
    xeroInvoiceId: "xero-1", xeroExportedAt: new Date("2026-11-01T00:00:00Z"), paidAt: null, paidAmount: null,
    updatedAt: new Date("2026-11-10T00:00:00Z"), metadata: { xeroExportState: "EXPORTED" }, lines: lines(),
  };
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    Object.assign(m.stored, data);
    m.stored.updatedAt = new Date(m.stored.updatedAt.getTime() + 1000);
    return m.stored;
  });
  m.audit.mockResolvedValue({});
  m.settings.mockResolvedValue({ xero: { defaultAccountCode: "200", disbursementAccountCode: "800", salesTaxType: "OUTPUT2", defaultItemCode: "", itemCodeByService: {} } });
  m.readInvoice.mockResolvedValue({ ok: true, document: document() });
  m.updateDocument.mockResolvedValue({ id: "xero-1", status: "DRAFT", total: 297 });
  m.session.mockResolvedValue({ user: actor });
});

const auditRows = () => m.audit.mock.calls.map(([args]) => args.data).filter((row) => row.action === "CLIENT_INVOICE_XERO_UPDATE");

describe("allowed by Xero", () => {
  it("DRAFT: re-sends the grouped lines to the same document and records who, what and the totals", async () => {
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, xeroInvoiceId: "xero-1", change: "order-only" });
    const call = m.updateDocument.mock.calls[0][0];
    expect(call).toMatchObject({ kind: "ACCREC", xeroId: "xero-1", gstEnabled: true });
    expect(call.idempotencyKey).toBe("client-invoice-update-inv-key-00000001");
    expect(call.lineItems.map((line: { description: string }) => line.description)).toEqual([XERO_LINES[1].description, XERO_LINES[0].description]);
    expect(m.pushInvoice).not.toHaveBeenCalled();
    expect(m.pushCredit).not.toHaveBeenCalled();
    expect(m.stored.xeroInvoiceId).toBe("xero-1");
    expect(m.stored.metadata).toMatchObject({ xeroExportState: "EXPORTED", xeroUpdate: { state: "DONE", key: "key-00000001", change: "order-only", xeroStatusBefore: "DRAFT" } });
    const [row] = auditRows();
    expect(row).toMatchObject({
      userId: "admin",
      entityId: "inv",
      after: { outcome: "updated", xeroInvoiceId: "xero-1", change: "order-only", xeroStatusBefore: "DRAFT", localTotal: 297, xeroTotalBefore: 297, totalsDiffered: false, confirmedDifference: false, lineCount: 2, xeroStatusAfter: "DRAFT", xeroTotalAfter: 297 },
    });
    expect(describeInvoiceAudit(row.action, row.after)).toBe("Updated in Xero (line order, Xero status draft)");
  });

  it("AUTHORISED with nothing applied: updated, still the same document", async () => {
    m.readInvoice.mockResolvedValue({ ok: true, document: document({ status: "AUTHORISED" }) });
    expect((await run()).status).toBe(200);
    expect(m.updateDocument.mock.calls[0][0].xeroId).toBe("xero-1");
  });

  it("a credit note: positive Xero amounts, the credit note's own id", async () => {
    Object.assign(m.stored, { kind: "CREDIT_NOTE", status: "SENT", totalAmount: -297, lines: lines().map((line) => ({ ...line, unitPrice: -line.unitPrice, lineTotal: -line.lineTotal })) });
    m.readCredit.mockResolvedValue({ ok: true, document: document({ kind: "ACCRECCREDIT", status: "AUTHORISED" }) });
    const result = await run();
    expect(result.status).toBe(200);
    const call = m.updateDocument.mock.calls[0][0];
    expect(call.kind).toBe("ACCRECCREDIT");
    expect(call.idempotencyKey).toBe("client-credit-note-update-inv-key-00000001");
    expect(call.lineItems.every((line: { unitAmount: number }) => line.unitAmount > 0)).toBe(true);
    expect(m.readInvoice).not.toHaveBeenCalled();
  });
});

describe("refused, nothing changed", () => {
  it.each([
    ["PAID", document({ status: "PAID", amountDue: 0, amountPaid: 297 }), /paid/],
    ["part-paid AUTHORISED", document({ status: "AUTHORISED", amountDue: 247, amountPaid: 50, payments: [{ paymentId: "p", date: "2026-11-05", amount: 50, status: "AUTHORISED", reference: null }] }), /\$50\.00 paid/],
    ["credited AUTHORISED", document({ status: "AUTHORISED", amountCredited: 20, amountDue: 277 }), /credit allocated/],
    ["VOIDED", document({ status: "VOIDED" }), /voided/],
    ["DELETED", document({ status: "DELETED" }), /deleted/],
  ])("%s in Xero", async (_name, xeroDocument, words) => {
    m.readInvoice.mockResolvedValue({ ok: true, document: xeroDocument });
    const before = JSON.stringify(m.stored);
    const result = await run();
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toMatch(words);
    expect(String(result.body.error)).toMatch(/Nothing was changed/);
    expect(m.updateDocument).not.toHaveBeenCalled();
    expect(JSON.stringify(m.stored)).toBe(before);
  });

  it("an allocated credit note", async () => {
    Object.assign(m.stored, { kind: "CREDIT_NOTE", status: "SENT", totalAmount: -297 });
    m.readCredit.mockResolvedValue({ ok: true, document: document({ kind: "ACCRECCREDIT", status: "AUTHORISED", amountDue: 100 }) });
    const result = await run();
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toMatch(/allocated or refunded/);
    expect(m.updateDocument).not.toHaveBeenCalled();
  });

  it("Xero's own 400 is shown in its words; the invoice stays pushed and its lines untouched", async () => {
    m.updateDocument.mockRejectedValue(new Error("Xero API error (400): Invoice not of valid status for modification"));
    const result = await run();
    expect(result.status).toBe(502);
    expect(String(result.body.error)).toContain("Invoice not of valid status for modification");
    expect(String(result.body.error)).toMatch(/Nothing was changed here/);
    expect(m.stored.xeroInvoiceId).toBe("xero-1");
    expect(m.stored.metadata).toMatchObject({ xeroExportState: "EXPORTED", xeroUpdate: { state: "FAILED", reason: "Xero API error (400): Invoice not of valid status for modification" } });
    // Only metadata is written: the reservation, then the failure.
    expect(m.update.mock.calls.every(([args]) => Object.keys(args.data).join() === "metadata")).toBe(true);
    expect(auditRows()[0].after).toMatchObject({ outcome: "failed", error: "Xero API error (400): Invoice not of valid status for modification" });
    expect(m.pushInvoice).not.toHaveBeenCalled();
  });

  it("a Xero read that fails sends nothing", async () => {
    m.readInvoice.mockResolvedValue({ ok: false, failure: { kind: "not-connected", reason: "No active Xero connection." } });
    const result = await run();
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toMatch(/No active Xero connection/);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateDocument).not.toHaveBeenCalled();
  });

  it("not in Xero, or void here", async () => {
    m.stored.xeroInvoiceId = null;
    expect((await run()).status).toBe(409);
    Object.assign(m.stored, { xeroInvoiceId: "xero-1", status: "VOID" });
    expect((await run()).status).toBe(409);
    expect(m.readInvoice).not.toHaveBeenCalled();
  });
});

describe("Xero's figures differ", () => {
  it("asks for confirmation with both totals, and only the same two totals authorise the overwrite", async () => {
    m.readInvoice.mockResolvedValue({ ok: true, document: document({ total: 310, lineItems: [...XERO_LINES, { description: "Added in Xero", quantity: 1, unitAmount: 13 }] }) });
    const asked = await run();
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: "XERO_UPDATE_NEEDS_CONFIRMATION", localTotal: 297, xeroTotal: 310, change: "amounts" });
    expect(String(asked.body.error)).toContain("Xero total $310.00; this invoice $297.00");
    expect(m.update).not.toHaveBeenCalled();
    expect(m.updateDocument).not.toHaveBeenCalled();

    expect((await run({ confirmTotals: { localTotal: 297, xeroTotal: 300 } })).status).toBe(409);
    expect(m.updateDocument).not.toHaveBeenCalled();

    const confirmed = await run({ confirmTotals: { localTotal: 297, xeroTotal: 310 } });
    expect(confirmed.status).toBe(200);
    expect(m.updateDocument).toHaveBeenCalledTimes(1);
    expect(auditRows()[0].after).toMatchObject({ totalsDiffered: true, confirmedDifference: true, xeroTotalBefore: 310 });
  });

  it("a paid Xero document is refused even when confirmed", async () => {
    m.readInvoice.mockResolvedValue({ ok: true, document: document({ status: "PAID", total: 310, amountPaid: 310, amountDue: 0 }) });
    expect((await run({ confirmTotals: { localTotal: 297, xeroTotal: 310 } })).status).toBe(409);
    expect(m.updateDocument).not.toHaveBeenCalled();
  });
});

describe("double-click and concurrency", () => {
  it("two clicks of one confirmation send one update", async () => {
    // Xero answers only after both clicks have been handled.
    let answer: (value: unknown) => void = () => undefined;
    const answered = new Promise((resolve) => { answer = resolve; });
    m.updateDocument.mockImplementation(() => answered);
    const first = run();
    const second = run();
    const settled = await Promise.race([second, first]);
    answer({ id: "xero-1", status: "DRAFT", total: 297 });
    const results = await Promise.all([first, second]);
    expect(settled.status).toBe(409);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(m.updateDocument).toHaveBeenCalledTimes(1);
    const again = await run();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ repeated: true });
    expect(m.updateDocument).toHaveBeenCalledTimes(1);
  });

  it("an update still with Xero blocks a second one", async () => {
    m.stored.metadata = { xeroUpdate: { state: "PENDING", key: "other-key-1", at: new Date().toISOString() } };
    const result = await run();
    expect(result.status).toBe(409);
    expect(String(result.body.error)).toMatch(/running/);
    expect(m.updateDocument).not.toHaveBeenCalled();
  });
});

describe("route authorization", () => {
  const post = (body: unknown = { requestKey: "key-00000001" }) =>
    POST(new NextRequest("http://localhost/api/admin/invoices/inv/xero-update", { method: "POST", body: JSON.stringify(body) }), { params: { id: "inv" } });

  it("asks for the same roles as the push (ADMIN, OPS_MANAGER)", async () => {
    m.session.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
    expect((await post()).status).toBe(200);
    expect(m.session).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });

  it("refuses other roles", async () => {
    m.session.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await post()).status).toBe(403);
    expect(m.readInvoice).not.toHaveBeenCalled();
  });

  it("refuses while viewing as someone else", async () => {
    m.session.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" }, impersonation: { actorId: "admin" } });
    expect((await post()).status).toBe(403);
    expect(m.readInvoice).not.toHaveBeenCalled();
    expect(m.updateDocument).not.toHaveBeenCalled();
  });

  it("refuses an impersonated actor at the action too", async () => {
    expect((await run({ actor: { ...actor, impersonatedBy: "someone" } })).status).toBe(403);
  });

  it("needs a request key", async () => {
    expect((await post({})).status).toBe(400);
  });
});
