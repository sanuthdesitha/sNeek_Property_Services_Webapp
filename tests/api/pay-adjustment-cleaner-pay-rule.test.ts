// @vitest-environment node
/**
 * Owner rule 2026-11-13 on the server: the amount paid on a cleaner pay
 * request defaults to what the cleaner REQUESTED, whatever the client approved;
 * more than requested is refused for an operations manager and for an
 * administrator without the override, and allowed for an administrator (real
 * session) with the override and a reason, audited with actor, both amounts
 * and the reason. Lower stays allowed. The client approval record (the client
 * charge) is only read, never changed. The Decided tab's Change amount follows
 * the same rule.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  job: vi.fn(),
  jobUpdateMany: vi.fn(),
  notification: vi.fn(),
  audit: vi.fn(),
  auditFind: vi.fn(),
  email: vi.fn(),
  outcome: vi.fn(),
  history: vi.fn(),
  listApprovals: vi.fn(),
  updateApproval: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({
  db: {
    cleanerPayAdjustment: { findUnique: m.find, update: m.update },
    job: { findUnique: m.job, updateMany: m.jobUpdateMany },
    notification: { create: m.notification },
    auditLog: { create: m.audit, findUnique: m.auditFind },
  },
}));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Test" }) }));
vi.mock("@/lib/commercial/client-approvals", () => ({
  listClientApprovals: m.listApprovals,
  deleteClientApprovalById: vi.fn(),
  getClientApprovalById: vi.fn(),
  updateClientApprovalById: m.updateApproval,
}));
vi.mock("@/lib/notifications/accountability", () => ({ notifyBonusOutcomeToCleaner: vi.fn() }));
vi.mock("@/lib/notifications/pay-adjustments", () => ({ notifyPayAdjustmentOutcome: m.outcome }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: m.history }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: vi.fn() }));

import { PATCH } from "@/app/api/admin/pay-adjustments/[id]/route";
import { POST as historyAction } from "@/app/api/admin/approvals/history/[id]/route";

const version = new Date("2026-11-13T00:00:00.000Z");
let row: Record<string, unknown>;

type SessionShape = { user: { id: string; role: string; heldRoles: string[] }; impersonation?: { actorId: string } };
const ADMIN: SessionShape = { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] } };
const OPS: SessionShape = { user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const IMPERSONATED_ADMIN: SessionShape = { user: { id: "admin2", role: "ADMIN", heldRoles: ["ADMIN"] }, impersonation: { actorId: "admin" } };

function clientApproval(status: string, amount: number, counterAmount: number | null = null) {
  return { id: "ca1", status, amount, counterAmount, updatedAt: "2026-11-13T01:00:00.000Z", metadata: { source: "pay_adjustment", payAdjustmentId: "pa1" } };
}

const patch = (body: unknown) => PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: { id: "pa1" } });

beforeEach(() => {
  vi.resetAllMocks();
  row = {
    id: "pa1",
    cleanerId: "cleaner",
    cleaner: { id: "cleaner", name: "Cleaner", email: "cleaner@local" },
    status: "PENDING",
    type: "FIXED",
    source: null,
    requestedAmount: 40,
    approvedAmount: null,
    requestedHours: null,
    requestedRate: null,
    updatedAt: version,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    job: null,
    property: null,
    title: "Extra hour",
    adminNote: null,
    decisionMessage: null,
  };
  m.role.mockResolvedValue(ADMIN);
  m.find.mockImplementation(async () => ({ ...row }));
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  m.outcome.mockResolvedValue(undefined);
  m.history.mockResolvedValue(undefined);
  m.listApprovals.mockResolvedValue([clientApproval("APPROVED", 60)]);
});

function storedApproved(): unknown {
  return m.update.mock.calls[0]?.[0]?.data?.approvedAmount;
}

describe("PATCH /api/admin/pay-adjustments/[id] — cleaner pay is the requested amount", () => {
  it.each([
    ["the client approved more", clientApproval("APPROVED", 60)],
    ["the client approved less", clientApproval("APPROVED", 30)],
    ["a counter-offer was accepted", clientApproval("APPROVED", 50)],
  ])("pays the requested amount when no amount is sent and %s", async (_label, approval) => {
    m.listApprovals.mockResolvedValue([approval]);
    const response = await patch({ status: "APPROVED" });
    expect(response.status).toBe(200);
    expect(storedApproved()).toBe(40);
    // The client charge is only read: the client approval record is untouched.
    expect(m.updateApproval).not.toHaveBeenCalled();
  });

  it("pays the requested amount when the request was never sent to the client", async () => {
    m.listApprovals.mockResolvedValue([]);
    expect((await patch({ status: "APPROVED" })).status).toBe(200);
    expect(storedApproved()).toBe(40);
  });

  it("allows a lower amount for an operations manager, as before", async () => {
    m.role.mockResolvedValue(OPS);
    expect((await patch({ status: "APPROVED", approvedAmount: 35.5 })).status).toBe(200);
    expect(storedApproved()).toBe(35.5);
  });

  it("refuses the client charge as the cleaner's pay for an operations manager", async () => {
    m.role.mockResolvedValue(OPS);
    const response = await patch({ status: "APPROVED", approvedAmount: 60, overrideAboveRequest: true, overrideReason: "Client paid more" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ABOVE_REQUEST", requestedAmount: 40 });
    expect(m.update).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("refuses more than requested for an administrator without the override flag", async () => {
    const response = await patch({ status: "APPROVED", approvedAmount: 60 });
    expect(response.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("refuses the override without a reason", async () => {
    const response = await patch({ status: "APPROVED", approvedAmount: 60, overrideAboveRequest: true, overrideReason: "  " });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "OVERRIDE_REASON_REQUIRED" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("refuses the override while an administrator is testing as another account", async () => {
    m.role.mockResolvedValue(IMPERSONATED_ADMIN);
    const response = await patch({ status: "APPROVED", approvedAmount: 60, overrideAboveRequest: true, overrideReason: "Agreed" });
    expect(response.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("allows an administrator override with a reason and audits actor, both amounts and the reason", async () => {
    const response = await patch({ status: "APPROVED", approvedAmount: 60, overrideAboveRequest: true, overrideReason: "Extra hour agreed on site" });
    expect(response.status).toBe(200);
    expect(storedApproved()).toBe(60);
    const overrideAudit = m.audit.mock.calls.map((call) => call[0].data).find((data) => data.action === "PAY_ADJUSTMENT_PAID_ABOVE_REQUEST");
    expect(overrideAudit).toMatchObject({
      userId: "admin",
      entity: "CleanerPayAdjustment",
      entityId: "pa1",
      after: { requestedAmount: 40, paidAmount: 60, reason: "Extra hour agreed on site", actorRole: "ADMIN" },
    });
    const reviewAudit = m.audit.mock.calls.map((call) => call[0].data).find((data) => data.action === "REVIEW_PAY_ADJUSTMENT");
    expect(reviewAudit.after.aboveRequestOverride).toEqual({ requestedAmount: 40, paidAmount: 60, reason: "Extra hour agreed on site" });
  });

  it("applies the same rule to editing an already approved amount", async () => {
    row.status = "APPROVED";
    row.approvedAmount = 40;
    m.role.mockResolvedValue(OPS);
    expect((await patch({ approvedAmount: 60 })).status).toBe(403);
    expect((await patch({ approvedAmount: 38 })).status).toBe(200);
    expect(storedApproved()).toBe(38);
  });

  it("leaves rectification deductions approved as raised", async () => {
    row.source = "RECTIFICATION_DEDUCTION";
    row.requestedAmount = -25;
    m.listApprovals.mockResolvedValue([]);
    m.role.mockResolvedValue(OPS);
    expect((await patch({ status: "APPROVED" })).status).toBe(200);
    expect(storedApproved()).toBe(-25);
  });
});

describe("Decided tab Change amount on a pay request", () => {
  const act = (body: unknown) => historyAction(new Request("http://local", { method: "POST", body: JSON.stringify(body) }) as never, { params: { id: "h1" } });

  beforeEach(() => {
    row.status = "APPROVED";
    row.approvedAmount = 40;
    m.auditFind.mockResolvedValue({
      id: "h1",
      entityId: "pa1",
      after: { approvalQueue: "payAdjustments", decision: "APPROVED", label: "Extra hour", amount: 40 },
    });
  });

  it("refuses more than requested for an operations manager", async () => {
    m.role.mockResolvedValue(OPS);
    const response = await act({ action: "edit", amount: 60, note: "Client approved 60", overrideAboveRequest: true });
    expect(response.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("allows an administrator override with the note as its reason, audited", async () => {
    const response = await act({ action: "edit", amount: 60, note: "Agreed extra hour", overrideAboveRequest: true });
    expect(response.status).toBe(200);
    expect(m.update.mock.calls[0][0].data.approvedAmount).toBe(60);
    const overrideAudit = m.audit.mock.calls.map((call) => call[0].data).find((data) => data.action === "PAY_ADJUSTMENT_PAID_ABOVE_REQUEST");
    expect(overrideAudit).toMatchObject({ userId: "admin", after: { requestedAmount: 40, paidAmount: 60, reason: "Agreed extra hour" } });
  });

  it("allows lowering the amount as before", async () => {
    m.role.mockResolvedValue(OPS);
    expect((await act({ action: "edit", amount: 30, note: "Shorter than claimed" })).status).toBe(200);
    expect(m.update.mock.calls[0][0].data.approvedAmount).toBe(30);
  });
});
