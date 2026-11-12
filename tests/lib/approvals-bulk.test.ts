/**
 * Approvals bulk decisions (2026-11 redesign): only queues whose decision
 * needs nothing per request, every row through the queue's single-decision
 * request, the single route's own access area checked for operations
 * managers, and an honest outcome per row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  payFindMany: vi.fn(),
  clientApproval: vi.fn(),
  opsAccess: vi.fn(),
  opsGrants: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { cleanerPayAdjustment: { findMany: m.payFindMany } } }));
vi.mock("@/lib/commercial/client-approvals", () => ({ getClientApprovalById: m.clientApproval }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.opsAccess, getOpsGrants: m.opsGrants }));

import { BulkDecisionNotAllowed, decisionRequestFor, runBulkDecision, type DecisionRequest } from "@/lib/admin/approvals/bulk";
import { APPROVAL_QUEUES, APPROVAL_QUEUE_ORDER } from "@/lib/admin/approvals/queues";

const admin = { id: "admin", role: "ADMIN" };
const manager = { id: "ops", role: "OPS_MANAGER" };

function levels(overrides: Record<string, string>) {
  return new Proxy(overrides, { get: (target, key: string) => target[key] ?? "manage" });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.opsAccess.mockResolvedValue(null);
  m.opsGrants.mockResolvedValue([]);
  m.payFindMany.mockResolvedValue([]);
});

describe("bulk rules per queue", () => {
  it("refuses bulk approve where each decision needs its own amount, minutes, score or reason", () => {
    // Pay requests are approved in bulk "as asked" since 2026-11-13 (tested below).
    expect(APPROVAL_QUEUES.payAdjustments.bulk.approve.allowed).toBe(true);
    for (const key of ["timeAdjustments", "bookingRequests", "managementReviews", "cleanerInvoicePayClaims"] as const) {
      expect(APPROVAL_QUEUES[key].bulk.approve.allowed).toBe(false);
    }
    expect(APPROVAL_QUEUES.bookingRequests.bulk.decline.allowed).toBe(false);
    expect(APPROVAL_QUEUES.continuations.reviewOnly).toBe(true);
    expect(APPROVAL_QUEUES.flaggedLaundry.reviewOnly).toBe(true);
  });

  it("has a single-decision request for every decision it allows in bulk", () => {
    for (const key of APPROVAL_QUEUE_ORDER) {
      for (const decision of ["approve", "decline"] as const) {
        const request = decisionRequestFor(key, decision, "x1");
        // Pay-request approval has its own per-row plan with each asked amount (planPayApprovals).
        const expected = key === "payAdjustments" && decision === "approve" ? false : APPROVAL_QUEUES[key].bulk[decision].allowed;
        expect(Boolean(request), `${key} ${decision}`).toBe(expected);
      }
    }
  });

  it("sends a decline note as the payee's message only when it is marked visible", () => {
    expect(decisionRequestFor("payAdjustments", "decline", "p1", "Duplicate", true)?.body).toEqual({ status: "REJECTED", decisionMessage: "Duplicate" });
    expect(decisionRequestFor("payAdjustments", "decline", "p1", "Duplicate", false)?.body).toEqual({ status: "REJECTED", adminNote: "Duplicate" });
    expect(decisionRequestFor("timingRequests", "approve", "t1")).toMatchObject({ path: "/api/admin/job-early-checkouts/t1", body: { status: "APPROVED" } });
  });
});

describe("runBulkDecision", () => {
  it("throws for a decision the queue does not allow in bulk", async () => {
    await expect(runBulkDecision({ queue: "bookingRequests", decision: "approve", ids: ["b1"], actor: admin, invoke: vi.fn() })).rejects.toBeInstanceOf(BulkDecisionNotAllowed);
  });

  it("decides each row through the single request and keeps going after a refusal", async () => {
    const seen: DecisionRequest[] = [];
    const invoke = vi.fn(async (request: DecisionRequest) => {
      seen.push(request);
      if (request.params?.id === "t2") return { status: 409, body: { error: "Already decided." } };
      return { status: 200, body: {} };
    });
    const result = await runBulkDecision({ queue: "timingRequests", decision: "approve", ids: ["t1", "t2", "t3", "t1"], actor: admin, invoke });
    expect(seen.map((request) => request.path)).toEqual(["/api/admin/job-early-checkouts/t1", "/api/admin/job-early-checkouts/t2", "/api/admin/job-early-checkouts/t3"]);
    expect(result.outcomes).toEqual([
      { id: "t1", status: "done", message: "Done." },
      { id: "t2", status: "refused", message: "Already decided." },
      { id: "t3", status: "done", message: "Done." },
    ]);
    expect([result.done, result.refused]).toEqual([2, 1]);
  });

  it("refuses every row when an operations manager's access does not cover the single route", async () => {
    m.opsAccess.mockResolvedValue(levels({ payroll: "read" }));
    const invoke = vi.fn();
    const result = await runBulkDecision({ queue: "rectificationAdjustments", decision: "approve", ids: ["r1", "r2"], actor: manager, invoke });
    expect(invoke).not.toHaveBeenCalled();
    expect(result.outcomes.every((row) => row.status === "refused" && /access/.test(row.message))).toBe(true);
  });

  it("lets an operations manager with the single route's area decide", async () => {
    m.opsAccess.mockResolvedValue(levels({}));
    m.payFindMany.mockResolvedValue([{ id: "r1", status: "PENDING", source: "QA_RECTIFICATION_PAY" }]);
    const invoke = vi.fn(async () => ({ status: 200, body: {} }));
    const result = await runBulkDecision({ queue: "rectificationAdjustments", decision: "approve", ids: ["r1"], actor: manager, invoke });
    expect(result.done).toBe(1);
  });

  it("refuses rows that are not in the queue or no longer pending", async () => {
    m.payFindMany.mockResolvedValue([
      { id: "p1", status: "PENDING", source: null },
      { id: "p2", status: "APPROVED", source: null },
      { id: "p3", status: "PENDING", source: "STREAK_5" },
    ]);
    const invoke = vi.fn(async () => ({ status: 200, body: {} }));
    const result = await runBulkDecision({ queue: "payAdjustments", decision: "decline", ids: ["p1", "p2", "p3", "gone"], actor: admin, invoke });
    expect(result.outcomes.map((row) => row.status)).toEqual(["done", "unchanged", "refused", "refused"]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("never approves a client's counter-offer or a pay request sent to the client in bulk", async () => {
    m.clientApproval.mockImplementation(async (id: string) =>
      id === "c1" ? { status: "PENDING", metadata: null } : id === "c2" ? { status: "COUNTERED", metadata: null } : { status: "PENDING", metadata: { source: "pay_adjustment" } },
    );
    const invoke = vi.fn(async () => ({ status: 200, body: {} }));
    const result = await runBulkDecision({ queue: "clientApprovals", decision: "approve", ids: ["c1", "c2", "c3"], actor: admin, invoke });
    expect(result.outcomes.map((row) => row.status)).toEqual(["done", "refused", "refused"]);
    expect(result.outcomes[1].message).toMatch(/counter-offer/);
  });

  it("reports a QA outcome the route skipped as no change", async () => {
    const invoke = vi.fn(async () => ({ status: 200, body: { approved: [], skipped: ["j1"] } }));
    const result = await runBulkDecision({ queue: "qaOutcomes", decision: "approve", ids: ["j1"], actor: admin, invoke });
    expect(result.outcomes[0]).toEqual({ id: "j1", status: "unchanged", message: "No longer awaiting approval." });
  });
});
