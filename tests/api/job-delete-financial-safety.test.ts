// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), verify: vi.fn(), read: vi.fn(), lock: vi.fn(), adjustments: vi.fn(), transfers: vi.fn(), qa: vi.fn(), claim: vi.fn(), remove: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: any) => fn(new Proxy({
  $queryRaw: m.lock,
  job: { findUnique: m.read, delete: m.remove },
  cleanerPayAdjustment: { count: m.adjustments, deleteMany: m.remove },
  qaReworkTransfer: { count: m.transfers, deleteMany: m.remove },
  qaAssignment: { count: m.qa, deleteMany: m.remove },
  cleanerInvoiceSubmission: { findFirst: m.claim },
  auditLog: { create: m.audit, deleteMany: m.remove },
}, { get: (target: any, key) => target[key] ?? { deleteMany: m.remove } })) } }));
vi.mock("@/lib/job-tasks/service", () => ({ syncAdminJobTasks: vi.fn(), notifyJobTasksAdded: vi.fn() }));
vi.mock("@/lib/accountability/rotation", () => ({ applyJobRotationCompletion: vi.fn() }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: m.verify }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: vi.fn() }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: vi.fn() }));
import { DELETE } from "@/app/api/admin/jobs/[id]/route";
const remove = () => DELETE(new NextRequest("http://localhost/api/admin/jobs/j", { method: "DELETE", body: "{}" }), { params: { id: "j" } });
let job: any;
beforeEach(() => {
  vi.resetAllMocks();
  job = { status: "COMPLETED", payrollRunId: null, cleanerPaidAt: null, invoiceLines: [] };
  m.read.mockImplementation(async () => job);
  m.auth.mockResolvedValue({ user: { id: "admin" } });
  m.adjustments.mockResolvedValue(0); m.transfers.mockResolvedValue(0); m.qa.mockResolvedValue(0); m.claim.mockResolvedValue(null);
});
it.each([
  { status: "INVOICED" }, { payrollRunId: "payroll" }, { cleanerPaidAt: new Date() }, { invoiceLines: [{ id: "line" }] },
])("refuses protected job before teardown %j", async patch => {
  Object.assign(job, patch);
  expect((await remove()).status).toBe(409);
  expect(m.remove).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
it.each(["adjustments", "transfers", "qa", "claim"] as const)("refuses related financial record: %s", async kind => {
  m[kind].mockResolvedValue(kind === "claim" ? { id: "invoice" } : 1);
  expect((await remove()).status).toBe(409); expect(m.remove).not.toHaveBeenCalled();
});
it("deletes ordinary unsettled job only after locks and claim inspection, with atomic audit", async () => {
  expect((await remove()).status).toBe(200);
  expect(m.auth).toHaveBeenCalledWith(["ADMIN"]); expect(m.verify).toHaveBeenCalled();
  expect(m.lock).toHaveBeenCalledTimes(2);
  expect(m.lock.mock.invocationCallOrder[1]).toBeLessThan(m.read.mock.invocationCallOrder[0]);
  expect(m.claim.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]);
  expect(m.claim).toHaveBeenCalledWith({ where: { status: { notIn: ["VOID", "CHANGES_REQUESTED"] }, lineData: { path: ["jobIds"], array_contains: ["j"] } }, select: { id: true } });
  expect(m.audit).toHaveBeenCalledWith({ data: { userId: "admin", action: "DELETE_JOB", entity: "Job", entityId: "j" } });
});
it("missing job after lock is 404 without teardown", async () => {
  job = null; expect((await remove()).status).toBe(404); expect(m.remove).not.toHaveBeenCalled();
});
it("sensitive verification failure never enters the lock or teardown", async () => {
  m.verify.mockRejectedValue(new Error("INVALID_SECURITY_VERIFICATION"));
  expect((await remove()).status).toBe(423); expect(m.lock).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
});
