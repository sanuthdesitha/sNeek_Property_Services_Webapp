// @vitest-environment node
/**
 * Blank invoices (POST /api/admin/invoices) and credit notes
 * (POST /api/admin/invoices/[id]/credit-note): existing numbering, limits,
 * negated lines that bill nothing, the original left untouched, role refusals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  number: vi.fn(),
  clientFind: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  lineUpdate: vi.fn(),
  audit: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
// Credit notes are a sensitive action (owner decision 2026-11-13): the own PIN is verified on the server.
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify, SensitiveVerificationError: class extends Error {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: true } }) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: m.number }));
vi.mock("@/lib/db", () => {
  const tx = () => ({
    $queryRaw: vi.fn(),
    clientInvoice: { findUnique: m.find, create: m.create, update: m.update },
    clientInvoiceLine: { update: m.lineUpdate },
    auditLog: { create: m.audit },
  });
  return { db: { client: { findUnique: m.clientFind }, ...tx(), $transaction: async (work: (client: unknown) => unknown) => work(tx()) } };
});

import { POST as createBlank } from "@/app/api/admin/invoices/route";
import { POST as createCredit } from "@/app/api/admin/invoices/[id]/credit-note/route";
import { creditNoteLinesFrom } from "@/lib/billing/client-invoice-create";

const blank = (body: unknown) => createBlank(new NextRequest("http://local/api/admin/invoices", { method: "POST", body: JSON.stringify(body) }));
const credit = (security: Record<string, string> = { pin: "2468" }) =>
  createCredit(new NextRequest("http://local/api/admin/invoices/orig/credit-note", { method: "POST", body: JSON.stringify({ security }) }), { params: { id: "orig" } });

let original: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.number.mockImplementation(async (key: string) => (key === "CREDIT_NOTE" ? "CN-0001" : "INV-0100"));
  m.clientFind.mockResolvedValue({ id: "c1", isActive: true });
  m.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "new", invoiceNumber: data.invoiceNumber }));
  m.audit.mockResolvedValue({});
  m.verify.mockResolvedValue(true);
  original = {
    id: "orig", kind: "INVOICE", status: "SENT", clientId: "c1", invoiceNumber: "INV-0042", totalAmount: 260, gstEnabled: true,
    periodStart: null, periodEnd: null, clientReference: "PO-5", creditNotes: [],
    lines: [
      { description: "Clean", note: "Back door", quantity: 1, unitPrice: 200, lineTotal: 200, category: "SERVICE", sortOrder: 0, propertyId: null, job: { propertyId: "p1" } },
      { description: "Supplies", note: null, quantity: 1, unitPrice: 40, lineTotal: 40, category: "SHOPPING_DISBURSEMENT", sortOrder: 1, propertyId: "p2", job: null },
    ],
  };
  m.find.mockImplementation(async () => original);
});

describe("blank invoice", () => {
  it("creates an empty DRAFT with the next client number and the chosen period", async () => {
    const response = await blank({ kind: "BLANK", clientId: "c1", periodStart: "2026-10-01", periodEnd: "2026-10-31" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "new", invoiceNumber: "INV-0100" });
    expect(m.number).toHaveBeenCalledWith("CLIENT");
    const data = m.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "DRAFT", kind: "INVOICE", subtotal: 0, totalAmount: 0, gstEnabled: true });
    expect(data.lines).toBeUndefined();
    expect(data.periodStart.toISOString()).toBe("2026-09-30T14:00:00.000Z");
  });

  it("refuses a missing period, an unknown or archived client and a reversed period", async () => {
    expect((await blank({ kind: "BLANK", clientId: "c1" })).status).toBe(400);
    m.clientFind.mockResolvedValueOnce(null);
    expect((await blank({ kind: "BLANK", clientId: "x", periodStart: "2026-10-01", periodEnd: "2026-10-02" })).status).toBe(404);
    m.clientFind.mockResolvedValueOnce({ id: "c1", isActive: false });
    expect((await blank({ kind: "BLANK", clientId: "c1", periodStart: "2026-10-01", periodEnd: "2026-10-02" })).status).toBe(409);
    expect((await blank({ kind: "BLANK", clientId: "c1", periodStart: "2026-10-05", periodEnd: "2026-10-02" })).status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("keeps the role guard: refusals are 401/403", async () => {
    m.auth.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await blank({ kind: "BLANK", clientId: "c1", periodStart: "2026-10-01", periodEnd: "2026-10-02" })).status).toBe(403);
    expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  });
});

describe("credit note", () => {
  it("creates a DRAFT on the CN rail with the original's lines negated and the original untouched", async () => {
    const before = JSON.stringify(original);
    const response = await credit();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ invoiceNumber: "CN-0001", remaining: 260, exceedsRemaining: false });
    expect(m.number).toHaveBeenCalledWith("CREDIT_NOTE");
    const data = m.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "CREDIT_NOTE", status: "DRAFT", creditsInvoiceId: "orig", clientReference: "PO-5", subtotal: -240, gstAmount: -20, totalAmount: -260 });
    expect(data.lines.create).toEqual([
      expect.objectContaining({ description: "Clean", unitPrice: -200, lineTotal: -200, category: "SERVICE", propertyId: "p1", note: "Back door" }),
      expect.objectContaining({ description: "Supplies", unitPrice: -40, lineTotal: -40, category: "SHOPPING_DISBURSEMENT", propertyId: "p2" }),
    ]);
    // Never edits the original: no update to any invoice or line, and the read record is unchanged.
    expect(m.update).not.toHaveBeenCalled();
    expect(m.lineUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(original)).toBe(before);
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_INVOICE_CREDIT_NOTE_CREATED", entityId: "new" }) });
  });

  it("copies no job, shopping run or shopping charge, so it bills nothing and locks nothing", () => {
    const lines = creditNoteLinesFrom({ lines: (original.lines as never) });
    for (const line of lines) {
      expect(line).not.toHaveProperty("jobId");
      expect(line).not.toHaveProperty("shoppingRunId");
      expect(line).not.toHaveProperty("shoppingClientChargeId");
    }
  });

  it("flags a pre-filled draft that exceeds what is left after earlier credits", async () => {
    original.creditNotes = [{ status: "SENT", totalAmount: -100 }, { status: "DRAFT", totalAmount: -260 }];
    expect(await (await credit()).json()).toMatchObject({ remaining: 160, exceedsRemaining: true });
  });

  it.each([
    [{ status: "DRAFT" }, /not been sent/],
    [{ status: "APPROVED" }, /not been sent/],
    [{ status: "VOID" }, /void/],
    [{ kind: "CREDIT_NOTE" }, /credit note/],
    [{ creditNotes: [{ status: "APPROVED", totalAmount: -260 }] }, /already been fully credited/],
  ])("refuses %j", async (change, message) => {
    Object.assign(original, change);
    const response = await credit();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(message);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.number).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown invoice and 403 for a refused role", async () => {
    m.find.mockResolvedValueOnce(null);
    expect((await credit()).status).toBe(404);
    m.auth.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await credit()).status).toBe(403);
  });
});
