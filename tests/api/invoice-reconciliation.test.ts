// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  verify: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  release: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/security/admin-verification", () => ({
  verifySensitiveAction: m.verify,
}));
vi.mock("@/lib/billing/client-invoices", () => ({
  releaseInvoiceConsumables: m.release,
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: m.lock,
        clientInvoice: { findUnique: m.find, update: m.update },
        auditLog: { create: m.audit },
      }),
  },
}));
import { POST } from "@/app/api/admin/invoices/[id]/reconcile/route";
const payload = {
  reason: "Duplicate corrected in Xero",
  reference: "XERO-VOID-123",
  confirmedInXero: true,
  security: { pin: "1234" },
};
const request = (body = payload) =>
  POST(
    new NextRequest("http://localhost/api/admin/invoices/invoice/reconcile", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: { id: "invoice" } },
  );
beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: "manager", role: "OPS_MANAGER" } });
  m.find.mockResolvedValue({
    id: "invoice",
    status: "SENT",
    xeroInvoiceId: "xero-id",
    paidAt: null,
    paidAmount: 0,
  });
});
describe("recording a reconciled Xero void", () => {
  it("verifies the explicit grant and credentials, preserves the issued document and audits the reason", async () => {
    expect((await request()).status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith(
      "manager",
      { pin: "1234" },
      "invoices.correct",
    );
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "invoice" },
      data: { status: "VOID" },
    });
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          after: expect.objectContaining({
            reason: payload.reason,
            reference: payload.reference,
          }),
        }),
      }),
    );
    expect(m.release).toHaveBeenCalledOnce();
  });
  it.each([
    { status: "PAID" },
    { payments: [{ status: "PENDING" }] },
    { paidAt: new Date() },
    { paidAmount: 1 },
    { metadata: { xeroExportState: "PENDING" } },
    { xeroInvoiceId: null },
  ])("refuses protected state %j before releasing work", async (state) => {
    m.find.mockResolvedValue({
      id: "invoice",
      status: "SENT",
      xeroInvoiceId: "xero-id",
      ...state,
    });
    expect((await request()).status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.release).not.toHaveBeenCalled();
  });
  it("does not repeat releases or audit on a retry of an already voided invoice", async () => {
    m.find.mockResolvedValue({
      id: "invoice",
      status: "VOID",
      xeroInvoiceId: "xero-id",
    });
    expect((await request()).status).toBe(200);
    expect(m.release).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("refuses missing acknowledgement and denied grants", async () => {
    expect((await request({ ...payload, confirmedInXero: false })).status).toBe(
      409,
    );
    m.verify.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await request()).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
});
