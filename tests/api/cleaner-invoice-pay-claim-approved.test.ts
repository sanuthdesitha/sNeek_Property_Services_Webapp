// @vitest-environment node
/** A payee can say "I've been paid" on an APPROVED invoice too (it sits between SUBMITTED and XERO_PUSHED). */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/invoicing/access", () => ({ requireInvoicePayeeSession: async () => ({ user: { id: "payee" } }), invoiceErrorMessage: (e: string) => e, invoiceErrorStatus: () => 400 }));
vi.mock("@/lib/uploads/ownership-server", () => ({ findForeignUploadKeys: async () => [] }));
vi.mock("@/lib/db", () => ({ db: { cleanerInvoiceSubmission: { findUnique: m.find, update: m.update }, auditLog: { create: m.audit } } }));
import { PATCH } from "@/app/api/cleaner/invoice/submissions/[id]/route";
const claim = () => PATCH(new NextRequest("http://local/x", { method: "PATCH", body: JSON.stringify({ status: "PAID_CLAIMED" }) }), { params: { id: "s" } });
beforeEach(() => {
  vi.clearAllMocks();
  m.update.mockResolvedValue({ id: "s", status: "PAID_CLAIMED", paidClaimedAt: new Date() });
  m.audit.mockResolvedValue({});
});
it.each(["SUBMITTED", "APPROVED", "XERO_PUSHED"])("accepts a claim on %s", async (status) => {
  m.find.mockResolvedValue({ id: "s", cleanerId: "payee", status });
  expect((await claim()).status).toBe(200);
});
it.each(["PAID", "VOID", "CHANGES_REQUESTED", "SENDING"])("refuses a claim on %s", async (status) => {
  m.find.mockResolvedValue({ id: "s", cleanerId: "payee", status });
  expect((await claim()).status).toBe(409);
  expect(m.update).not.toHaveBeenCalled();
});
