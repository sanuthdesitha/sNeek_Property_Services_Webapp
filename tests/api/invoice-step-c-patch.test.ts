// @vitest-environment node
/**
 * Money step (c) through PATCH/DELETE /api/admin/invoices/[id]: the server
 * edit lock per status, client reference and note, discounts, credit-note
 * rules, the empty-invoice approval refusal, reverse only before sending, and
 * the server-side PIN for removing a line and deleting an invoice.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  verify: vi.fn(),
  find: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  lines: vi.fn(),
  lineCreate: vi.fn(),
  lineDelete: vi.fn(),
  lineUpdate: vi.fn(),
  audit: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), releaseInvoiceConsumables: m.release }));
vi.mock("@/lib/db", () => {
  const client = () => ({
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    clientInvoice: { findUnique: m.find, findMany: m.findMany, count: m.count, update: m.update, delete: m.remove },
    clientInvoiceLine: { findMany: m.lines, create: m.lineCreate, delete: m.lineDelete, update: m.lineUpdate, updateMany: vi.fn() },
    auditLog: { create: m.audit },
  });
  return { db: { ...client(), $transaction: async (work: (tx: unknown) => unknown) => work(client()) } };
});

import { DELETE, GET, PATCH } from "@/app/api/admin/invoices/[id]/route";
import { ISSUED_INVOICE_REFUSAL } from "@/lib/billing/client-invoice-guards";

const context = { params: { id: "inv" } };
const lineId = "cl00000000000000000000001";
const patch = (body: unknown) => PATCH(new NextRequest("http://local/api/admin/invoices/inv", { method: "PATCH", body: JSON.stringify(body) }), context);
const remove = (body: unknown) => DELETE(new NextRequest("http://local/api/admin/invoices/inv", { method: "DELETE", body: JSON.stringify(body) }), context);

let invoice: Record<string, unknown> & { lines: Array<Record<string, unknown>> };
let storedLines: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.verify.mockResolvedValue(true);
  m.audit.mockResolvedValue({});
  invoice = {
    id: "inv", kind: "INVOICE", status: "DRAFT", invoiceNumber: "INV-1", clientId: "c1", creditsInvoiceId: null,
    subtotal: 200, gstAmount: 20, totalAmount: 220, gstEnabled: true, metadata: null, paidAt: null, paidAmount: null, xeroInvoiceId: null,
    lines: [{ id: lineId, jobId: null, shoppingClientChargeId: null, shoppingRunId: null, quantity: 1, unitPrice: 200, lineTotal: 200, category: "SERVICE", sortOrder: 0 }],
  };
  storedLines = [...invoice.lines];
  m.find.mockImplementation(async () => invoice);
  m.findMany.mockResolvedValue([]);
  m.count.mockResolvedValue(0);
  m.lines.mockImplementation(async () => storedLines);
  m.lineCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { storedLines = [...storedLines, data]; return data; });
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...invoice, ...data }));
});

describe("server-side edit lock", () => {
  it.each(["SENT", "PART_PAID", "PAID", "VOID"])("refuses content edits on %s", async (status) => {
    invoice.status = status;
    for (const body of [{ clientReference: "PO-1" }, { clientNote: "Hi" }, { gstEnabled: false }, { addDiscount: { amount: 5 } }, { updateLines: [{ id: lineId, description: "x" }] }]) {
      const response = await patch(body);
      expect(response.status).toBe(409);
      if (status !== "VOID") expect((await response.json()).error).toBe(ISSUED_INVOICE_REFUSAL);
    }
    expect(m.update).not.toHaveBeenCalled();
    expect(m.lineCreate).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "APPROVED"])("saves the client reference and note on %s", async (status) => {
    invoice.status = status;
    expect((await patch({ clientReference: " PO-77 ", clientNote: "Thank you" })).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ clientReference: "PO-77", clientNote: "Thank you" }) }));
  });

  it("still lets a sent invoice take a payment (status moves follow the graph)", async () => {
    invoice.status = "SENT";
    expect((await patch({ recordPayment: { amount: 20, method: "CASH" } })).status).toBe(200);
  });

  it("settles to PAID when a payment plus approved credits cover the total", async () => {
    invoice.status = "SENT";
    m.findMany.mockResolvedValue([{ status: "SENT", totalAmount: -200 }]);
    await patch({ recordPayment: { amount: 20, method: "CASH" } });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }));
  });
});

describe("discounts", () => {
  it("adds a percentage discount as a negative DISCOUNT line with its basis, and totals it", async () => {
    const response = await patch({ addDiscount: { percent: 10 } });
    expect(response.status).toBe(200);
    expect(m.lineCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ category: "DISCOUNT", unitPrice: -20, lineTotal: -20, discountPercent: 10, description: "Discount (10%)" }) });
    expect(await response.json()).toMatchObject({ gstAmount: 18, totalAmount: 198 });
  });

  it("refuses a discount that would take the total below zero, writing nothing", async () => {
    const response = await patch({ addDiscount: { amount: 250 } });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/below zero/);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("refuses editing a discount's amount and a negative ordinary charge", async () => {
    invoice.lines.push({ id: "cl00000000000000000000002", category: "DISCOUNT", quantity: 1, unitPrice: -10, lineTotal: -10, jobId: null, shoppingClientChargeId: null, shoppingRunId: null, sortOrder: 1 });
    expect((await patch({ updateLines: [{ id: "cl00000000000000000000002", unitPrice: -50 }] })).status).toBe(400);
    expect((await patch({ addLine: { description: "Neg", unitPrice: -5 } })).status).toBe(400);
  });
});

describe("blank invoices and credit notes", () => {
  it("cannot approve or send an invoice with no lines", async () => {
    invoice.lines = [];
    expect((await patch({ status: "APPROVED" })).status).toBe(409);
    expect((await patch({ status: "SENT" })).status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("never records a payment on a credit note", async () => {
    Object.assign(invoice, { kind: "CREDIT_NOTE", creditsInvoiceId: "orig", status: "SENT", totalAmount: -50 });
    expect((await patch({ recordPayment: { amount: 5, method: "CASH" } })).status).toBe(409);
    expect((await patch({ status: "PAID" })).status).toBe(409);
  });

  it("refuses approving a credit note above what the invoice has left, and allows a partial one", async () => {
    Object.assign(invoice, { kind: "CREDIT_NOTE", creditsInvoiceId: "orig", totalAmount: -220, lines: [{ id: lineId, category: "SERVICE", lineTotal: -200, unitPrice: -200, quantity: 1, sortOrder: 0, jobId: null }] });
    m.find.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "orig" ? { invoiceNumber: "INV-9", totalAmount: 220, creditNotes: [{ status: "SENT", totalAmount: -100 }] } : invoice);
    storedLines = [...invoice.lines];
    const refused = await patch({ status: "APPROVED" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/more than INV-9 has left to credit \(\$120\.00\)/);
    // A partial credit whose stored total matches its lines (Wave D: totals must match to approve).
    invoice.totalAmount = -110;
    invoice.lines = [{ id: lineId, category: "SERVICE", lineTotal: -100, unitPrice: -100, quantity: 1, sortOrder: 0, jobId: null }];
    storedLines = [...invoice.lines];
    expect((await patch({ status: "APPROVED" })).status).toBe(200);
  });

  it("refuses voiding an invoice that still has live credit notes", async () => {
    invoice.status = "SENT";
    m.count.mockResolvedValue(1);
    expect((await patch({ status: "VOID", voidReason: "Duplicate" })).status).toBe(409);
  });

  // Owner default 2026-11-14 (pending confirmation): the void reason is written to the audit row only.
  it("records the void reason in a CLIENT_INVOICE_VOIDED audit row without changing amounts", async () => {
    invoice.status = "SENT";
    expect((await patch({ status: "VOID", voidReason: "Wrong client" })).status).toBe(200);
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_INVOICE_VOIDED", entityId: "inv", after: expect.objectContaining({ reason: "Wrong client", status: "VOID" }) }) });
    const update = m.update.mock.calls.find(([call]) => call.data.status === "VOID")?.[0];
    expect(update.data).toMatchObject({ status: "VOID", totalAmount: 220 });
  });

  it("refuses Reverse on a sent invoice and points to credit notes", async () => {
    invoice.status = "SENT";
    const response = await patch({ reverse: {} });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/credit note/i);
  });

  it("still reverses an approved invoice", async () => {
    invoice.status = "APPROVED";
    expect((await patch({ reverse: {} })).status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }));
  });
});

describe("server-side PIN", () => {
  // Owner default 2026-11-14 (pending confirmation): removing a line from a
  // DRAFT is tier B (no PIN, Undo in the editor). Past DRAFT the PIN stays.
  it("removes a line from a DRAFT without asking for a PIN", async () => {
    invoice.status = "DRAFT";
    expect((await patch({ removeLineId: lineId })).status).toBe(200);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.lineDelete).toHaveBeenCalled();
  });

  it("removes a line from an APPROVED invoice only when the server accepts the PIN", async () => {
    invoice.status = "APPROVED";
    expect((await patch({ removeLineId: lineId, security: { pin: "1234" } })).status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "1234" });
    expect(m.lineDelete).toHaveBeenCalled();
  });

  it.each(["INVALID_SECURITY_VERIFICATION", "PIN_OR_PASSWORD_REQUIRED"])("refuses line removal past DRAFT with %s (423) and changes nothing", async (code) => {
    invoice.status = "APPROVED";
    m.verify.mockRejectedValue(new Error(code));
    const response = await patch({ removeLineId: lineId });
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: code });
    expect(m.lineDelete).not.toHaveBeenCalled();
  });

  it("refuses line removal past DRAFT while impersonating", async () => {
    invoice.status = "APPROVED";
    m.auth.mockResolvedValue({ user: { id: "target", role: "OPS_MANAGER" }, impersonation: { actorId: "admin" } });
    expect((await patch({ removeLineId: lineId, security: { pin: "1234" } })).status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.lineDelete).not.toHaveBeenCalled();
  });

  it("refuses a PIN-less removal when the draft was approved before the row lock", async () => {
    let reads = 0;
    m.find.mockImplementation(async () => ({ ...invoice, status: reads++ === 0 ? "DRAFT" : "APPROVED" }));
    const response = await patch({ removeLineId: lineId });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/no longer a draft/);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.lineDelete).not.toHaveBeenCalled();
  });

  it("deletes a draft only with a valid credential checked on the server", async () => {
    m.verify.mockRejectedValueOnce(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await remove({ security: { pin: "0000" } })).status).toBe(423);
    expect(m.remove).not.toHaveBeenCalled();
    expect((await remove({ security: { password: "secret" } })).status).toBe(200);
    expect(m.verify).toHaveBeenLastCalledWith("admin", { password: "secret" });
    expect(m.remove).toHaveBeenCalled();
  });
});

describe("route guards (pre-existing fix)", () => {
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]] as const)("GET and DELETE answer %s with %i, not 400", async (code, status) => {
    m.auth.mockRejectedValue(new Error(code));
    expect((await GET(new NextRequest("http://local/api/admin/invoices/inv"), context)).status).toBe(status);
    expect((await remove({})).status).toBe(status);
    expect((await patch({ status: "APPROVED" })).status).toBe(status);
  });

  it("keeps the ADMIN and OPS_MANAGER role list", async () => {
    await patch({ clientReference: "x" });
    expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });
});
