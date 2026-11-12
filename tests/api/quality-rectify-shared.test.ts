// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  findUnique: vi.fn(),
  settings: vi.fn(),
  transaction: vi.fn(),
  payFindFirst: vi.fn(),
  payCreate: vi.fn(),
  issueUpdate: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: vi.fn() }));
vi.mock("@/lib/qa/authority", () => ({ recomputeJobQaOutcome: vi.fn() }));
const tx = {
  cleanerPayAdjustment: { findFirst: m.payFindFirst, create: m.payCreate },
  qaIssue: { update: m.issueUpdate },
  auditLog: { create: m.audit },
};
vi.mock("@/lib/db", () => ({ db: { qaIssue: { findUnique: m.findUnique }, $transaction: m.transaction } }));

import { PATCH } from "@/app/api/admin/qa/issues/[id]/route";

const ISSUE = {
  id: "issue1",
  jobId: "job1",
  propertyId: "prop1",
  cleanerId: "cleaner1",
  raisedById: "qa1",
  category: "kitchen",
  rectificationStatus: "PENDING",
  rectificationMinutes: null,
  rectificationCost: null,
  rectifiedById: null,
  payAdjustmentId: null,
};
const patch = (body: unknown) =>
  PATCH(new NextRequest("http://localhost/api/admin/qa/issues/issue1", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "issue1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.findUnique.mockResolvedValue(ISSUE);
  m.settings.mockResolvedValue({
    accountability: {
      issueCategories: [{ key: "kitchen", label: "Kitchen" }],
      rectification: { bands: [{ maxMinutes: 30, amount: 15 }], managerReviewOverMinutes: 120 },
    },
  });
  m.transaction.mockImplementation(async (fn: (client: typeof tx) => unknown) => fn(tx));
  m.payFindFirst.mockResolvedValue(null);
  m.payCreate.mockResolvedValue({ id: "pay1" });
  m.issueUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...ISSUE, ...data }));
  m.audit.mockResolvedValue({});
});

describe("PATCH /api/admin/qa/issues/[id] rectify (moved to lib/quality/rectify)", () => {
  it("still pays the QA who raised it as a PENDING adjustment, never the recording admin", async () => {
    const response = await patch({ action: "rectify", status: "FIXED_BY_QA", minutes: 20 });
    expect(response.status).toBe(200);
    expect(m.payCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ cleanerId: "qa1", status: "PENDING", source: "QA_RECTIFICATION_PAY", requestedAmount: 15, title: "QA rectification — Kitchen" }),
    });
    expect(m.issueUpdate.mock.calls[0][0].data).toMatchObject({ rectificationStatus: "FIXED_BY_QA", rectifiedById: "qa1", rectificationMinutes: 20, payAdjustmentId: "pay1" });
    expect(m.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "QA_ISSUE_RECTIFY", userId: "admin", after: expect.objectContaining({ rectificationPayeeSource: "ISSUE_RAISER" }) }),
    });
  });

  it("creates no money for a manager fix and keeps the inspector-only rectify permission", async () => {
    m.role.mockResolvedValue({ user: { id: "qa2", role: "QA_INSPECTOR" } });
    expect((await patch({ action: "rectify", status: "FIXED_BY_MANAGER" })).status).toBe(200);
    expect(m.payCreate).not.toHaveBeenCalled();
    expect((await patch({ action: "proposeDeduction", amount: 10, note: "x" })).status).toBe(403);
  });
});
