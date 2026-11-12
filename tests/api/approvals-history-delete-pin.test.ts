/**
 * Decided tab → Delete record: the PIN or password is verified by the history
 * route itself (before 2026-11 only the browser checked it, so a direct
 * request deleted without one).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), verify: vi.fn(), findUnique: vi.fn(), payFind: vi.fn(), payDelete: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: m.record }));
vi.mock("@/lib/notifications/pay-adjustments", () => ({ notifyPayAdjustmentOutcome: vi.fn(async () => undefined) }));
vi.mock("@/lib/commercial/client-approvals", () => ({ deleteClientApprovalById: vi.fn(), getClientApprovalById: vi.fn(), updateClientApprovalById: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    auditLog: { findUnique: m.findUnique },
    cleanerPayAdjustment: { findUnique: m.payFind, delete: m.payDelete },
  },
}));

import { POST } from "@/app/api/admin/approvals/history/[id]/route";

const call = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/admin/approvals/history/h1", { method: "POST", body: JSON.stringify(body) }), { params: { id: "h1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.findUnique.mockResolvedValue({ id: "h1", entityId: "p1", after: { approvalQueue: "payAdjustments", decision: "DECLINED" } });
  m.payFind.mockResolvedValue({ id: "p1", status: "REJECTED", includedInPayrollRunId: null, includedInCleanerInvoiceId: null, cleanerId: "c1", cleaner: { id: "c1", name: "C", email: "c@x" }, jobId: null, title: "Parking", approvedAmount: null, requestedAmount: 12 });
});

describe("approval history delete", () => {
  it("refuses a delete without a valid PIN or password and deletes nothing", async () => {
    m.verify.mockRejectedValueOnce(new Error("PIN_OR_PASSWORD_REQUIRED"));
    const missing = await call({ action: "delete" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/PIN or password/);
    m.verify.mockRejectedValueOnce(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await call({ action: "delete", security: { pin: "0000" } })).status).toBe(400);
    expect(m.payDelete).not.toHaveBeenCalled();
  });

  it("deletes after the server accepts the PIN", async () => {
    m.verify.mockResolvedValueOnce(true);
    const response = await call({ action: "delete", security: { pin: "1234" } });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "1234" });
    expect(m.payDelete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("does not ask for a PIN to reverse a decision", async () => {
    m.payFind.mockResolvedValue({ id: "p1", status: "APPROVED", includedInPayrollRunId: null, includedInCleanerInvoiceId: null, cleanerId: "c1", cleaner: { id: "c1", name: "C", email: "c@x" }, jobId: null, title: "Parking", approvedAmount: 12, requestedAmount: 12 });
    await call({ action: "undo" });
    expect(m.verify).not.toHaveBeenCalled();
  });
});
