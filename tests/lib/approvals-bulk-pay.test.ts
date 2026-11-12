/**
 * Bulk approve pay requests "as asked" (owner decision 2026-11-13: "bulk
 * approve supports if each is ok to approve"): each row goes through the single
 * pay-request route at ITS OWN asked amount, only when it passes every check a
 * single approval needs; every other row is refused with its reason, and the
 * viewer's Payroll access is checked for an operations manager.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  payFindMany: vi.fn(),
  listApprovals: vi.fn(),
  opsAccess: vi.fn(),
  opsGrants: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { cleanerPayAdjustment: { findMany: m.payFindMany } } }));
vi.mock("@/lib/commercial/client-approvals", () => ({ getClientApprovalById: vi.fn(), listClientApprovals: m.listApprovals }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.opsAccess, getOpsGrants: m.opsGrants }));

import { planPayApprovals, runBulkDecision, type DecisionRequest } from "@/lib/admin/approvals/bulk";

const admin = { id: "admin", role: "ADMIN" };
const manager = { id: "ops", role: "OPS_MANAGER" };
const receipt = ["receipts/r.jpg"];

function levels(overrides: Record<string, string>) {
  return new Proxy(overrides, { get: (target, key: string) => target[key] ?? "manage" });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.opsAccess.mockResolvedValue(null);
  m.opsGrants.mockResolvedValue([]);
  m.listApprovals.mockResolvedValue([]);
  m.payFindMany.mockResolvedValue([
    { id: "ok1", status: "PENDING", source: null, requestedAmount: 12.5, attachmentKeys: receipt },
    { id: "ok2", status: "PENDING", source: null, requestedAmount: 30, attachmentKeys: receipt },
    { id: "noreceipt", status: "PENDING", source: null, requestedAmount: 9, attachmentKeys: [] },
    { id: "zero", status: "PENDING", source: null, requestedAmount: 0, attachmentKeys: receipt },
    { id: "decided", status: "APPROVED", source: null, requestedAmount: 5, attachmentKeys: receipt },
    { id: "bonus", status: "PENDING", source: "STREAK_5", requestedAmount: 5, attachmentKeys: receipt },
    { id: "client", status: "PENDING", source: null, requestedAmount: 40, attachmentKeys: receipt },
    { id: "changed", status: "PENDING", source: null, requestedAmount: 22, attachmentKeys: receipt },
  ]);
});

describe("planPayApprovals", () => {
  it("approves only rows that pass every single-approval check, each at its own asked amount", async () => {
    m.listApprovals.mockResolvedValue([
      { status: "PENDING", amount: 45, updatedAt: "2026-11-12T00:00:00Z", metadata: { source: "pay_adjustment", payAdjustmentId: "client" } },
    ]);
    const plan = await planPayApprovals(
      ["ok1", "ok2", "noreceipt", "zero", "decided", "bonus", "client", "changed", "gone"],
      { ok1: 12.5, ok2: 30, noreceipt: 9, zero: 0, decided: 5, bonus: 5, client: 40, changed: 20 },
    );
    expect(Object.fromEntries(plan.approve)).toEqual({ ok1: 12.5, ok2: 30 });
    const reason = (id: string) => plan.refusals.get(id)?.message ?? "";
    expect(reason("noreceipt")).toMatch(/No receipt/);
    expect(reason("zero")).toMatch(/No valid amount/);
    expect(plan.refusals.get("decided")?.status).toBe("unchanged");
    expect(reason("bonus")).toMatch(/not a pay request/);
    expect(reason("client")).toMatch(/client's approval/);
    expect(reason("changed")).toMatch(/now \$22\.00 \(you confirmed \$20\.00\)/);
    expect(reason("gone")).toMatch(/no longer exists/);
  });

  it("uses the client-approved amount when the client approved the charge", async () => {
    m.listApprovals.mockResolvedValue([
      { status: "APPROVED", amount: 35, updatedAt: "2026-11-12T00:00:00Z", metadata: { source: "pay_adjustment", payAdjustmentId: "client" } },
    ]);
    const plan = await planPayApprovals(["client"], { client: 35 });
    expect(plan.approve.get("client")).toBe(35);
  });

  it("refuses a row whose amount was not confirmed", async () => {
    const plan = await planPayApprovals(["ok1"], {});
    expect(plan.approve.size).toBe(0);
    expect(plan.refusals.get("ok1")?.message).toMatch(/not confirmed/);
  });
});

describe("runBulkDecision for pay requests", () => {
  it("sends each passing row to the single pay route with its own amount and keeps the rest refused", async () => {
    const seen: DecisionRequest[] = [];
    const invoke = vi.fn(async (request: DecisionRequest) => {
      seen.push(request);
      if (request.params?.id === "ok2") return { status: 403, body: { error: "You cannot approve your own QA rectification pay." } };
      return { status: 200, body: {} };
    });
    const result = await runBulkDecision({
      queue: "payAdjustments",
      decision: "approve",
      ids: ["ok1", "ok2", "noreceipt"],
      expectedAmounts: { ok1: 12.5, ok2: 30, noreceipt: 9 },
      actor: admin,
      invoke,
    });
    expect(seen.map((request) => [request.path, request.body])).toEqual([
      ["/api/admin/pay-adjustments/ok1", { status: "APPROVED", approvedAmount: 12.5 }],
      ["/api/admin/pay-adjustments/ok2", { status: "APPROVED", approvedAmount: 30 }],
    ]);
    expect(result.outcomes.map((row) => row.status)).toEqual(["done", "refused", "refused"]);
    expect(result.outcomes[1].message).toMatch(/own QA rectification/);
    expect([result.done, result.refused]).toEqual([1, 2]);
  });

  it("refuses every row for an operations manager without Payroll access", async () => {
    m.opsAccess.mockResolvedValue(levels({ payroll: "read" }));
    const invoke = vi.fn();
    const result = await runBulkDecision({ queue: "payAdjustments", decision: "approve", ids: ["ok1"], expectedAmounts: { ok1: 12.5 }, actor: manager, invoke });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.outcomes[0]).toMatchObject({ status: "refused", message: expect.stringMatching(/access/) });
  });
});
