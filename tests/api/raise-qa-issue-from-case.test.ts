// @vitest-environment node
/**
 * Cases → "Raise QA issue for cleaner" (owner decision, fourth set item 1):
 * POST /api/admin/quality/issues over lib/quality/raise-from-case.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(), ops: vi.fn(), ticket: vi.fn(), job: vi.fn(), attachments: vi.fn(), media: vi.fn(), transaction: vi.fn(), payRows: vi.fn(),
  tx: {
    $executeRaw: vi.fn(), auditLog: { findFirst: vi.fn(), create: vi.fn() }, qaIssue: { findFirst: vi.fn(), create: vi.fn() },
    caseComment: { create: vi.fn() }, cleanerPayAdjustment: { create: vi.fn() }, qAReview: { update: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountability: { issueCategories: [{ key: "bathroom", label: "Bathroom" }, { key: "kitchen", label: "Kitchen" }] } }) }));
vi.mock("@/lib/db", () => ({ db: {
  issueTicket: { findUnique: m.ticket }, job: { findUnique: m.job }, caseAttachment: { findMany: m.attachments }, submissionMedia: { findMany: m.media },
  cleanerPayAdjustment: { findMany: m.payRows }, $transaction: m.transaction,
} }));

import { POST } from "@/app/api/admin/quality/issues/route";
import { raiseQaIssueFromCase } from "@/lib/quality/raise-from-case";
import { toIssueRows } from "@/lib/quality/issue-rows";

const body = { caseId: "case-1", cleanerId: "cleaner-1", category: "bathroom", severity: "MAJOR", description: "Shower screen left dirty", idempotencyKey: "qa-case-abcdef12" };
const post = (data: unknown) => POST(new NextRequest("http://localhost/api/admin/quality/issues", { method: "POST", body: JSON.stringify(data) }));

function asRole(role: string, extra: Record<string, unknown> = {}) {
  m.auth.mockImplementation(async (roles: string[]) => {
    if (!roles.includes(role)) throw new Error("FORBIDDEN");
    return { user: { id: "office-1", role }, ...extra };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  asRole("ADMIN");
  m.ops.mockResolvedValue(null);
  m.ticket.mockResolvedValue({ id: "case-1", jobId: "job-1" });
  m.job.mockResolvedValue({ id: "job-1", propertyId: "prop-1", assignments: [{ userId: "cleaner-1", user: { name: "Aiko", email: "a@example.invalid" } }, { userId: "cleaner-2", user: { name: "Marco", email: null } }] });
  m.attachments.mockResolvedValue([]);
  m.media.mockResolvedValue([]);
  m.transaction.mockImplementation(async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx));
  m.tx.auditLog.findFirst.mockResolvedValue(null);
  m.tx.qaIssue.findFirst.mockResolvedValue(null);
  m.tx.qaIssue.create.mockResolvedValue({ id: "issue-1" });
});

describe("who may raise", () => {
  it("refuses a QA inspector (not via this route)", async () => {
    asRole("QA_INSPECTOR");
    expect((await post(body)).status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("refuses an operations manager whose quality pack is read-only, and allows one at manage", async () => {
    asRole("OPS_MANAGER");
    m.ops.mockResolvedValue({ quality: "read" });
    expect((await post(body)).status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled();
    m.ops.mockResolvedValue({ quality: "manage" });
    expect((await post(body)).status).toBe(201);
  });

  it("refuses while impersonating, so raisedById is the real person", async () => {
    asRole("ADMIN", { impersonation: { actorId: "real", mode: "FULL", startedAt: 1 } });
    expect((await post(body)).status).toBe(403);
  });
});

describe("what is created", () => {
  it("creates a normal QA issue on the case's job and cleaner, marked as raised from the case, with an internal case note", async () => {
    m.attachments.mockResolvedValue([{ id: "att-1", s3Key: "cases/case-1/photo.jpg" }]);
    m.media.mockResolvedValue([{ id: "media-1", s3Key: "jobs/job-1/forms/shower.jpg" }]);
    const response = await post({ ...body, attachmentIds: ["att-1"], jobMediaIds: ["media-1"] });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ issueId: "issue-1", duplicate: false, href: "/v2/admin/quality?tab=issues&q=issue-1" });
    expect(m.tx.qaIssue.create).toHaveBeenCalledWith({ data: {
      jobId: "job-1", propertyId: "prop-1", cleanerId: "cleaner-1", raisedById: "office-1", category: "bathroom",
      itemKey: "case:case-1", description: "Shower screen left dirty", severity: "MAJOR",
      qaPhotoKeys: [{ key: "cases/case-1/photo.jpg" }, { key: "jobs/job-1/forms/shower.jpg" }], cleanerMediaIds: ["media-1"],
    }, select: { id: true } });
    expect(m.tx.caseComment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ caseId: "case-1", authorUserId: "office-1", isInternal: true, body: expect.stringContaining("/v2/admin/quality?tab=issues&q=issue-1") }) });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "QA_ISSUE_RAISED_FROM_CASE", entityId: "issue-1", after: expect.objectContaining({ caseId: "case-1", deductionCreated: false }) }) });
  });

  it("never creates a deduction or touches a QA review", async () => {
    await raiseQaIssueFromCase("office-1", body);
    expect(m.tx.cleanerPayAdjustment.create).not.toHaveBeenCalled();
    expect(m.tx.qAReview.update).not.toHaveBeenCalled();
    expect(m.tx.qAReview.create).not.toHaveBeenCalled();
    expect(m.tx.qaIssue.create.mock.calls[0][0].data).not.toHaveProperty("payAdjustmentId");
    expect(m.tx.qaIssue.create.mock.calls[0][0].data).not.toHaveProperty("qaReviewId");
  });

  it("refuses a cleaner not on the job, an unknown category, a case without a job and evidence from elsewhere", async () => {
    await expect(raiseQaIssueFromCase("office-1", { ...body, cleanerId: "stranger" })).rejects.toMatchObject({ status: 400 });
    await expect(raiseQaIssueFromCase("office-1", { ...body, category: "made-up" })).rejects.toMatchObject({ status: 400 });
    m.attachments.mockResolvedValue([]);
    await expect(raiseQaIssueFromCase("office-1", { ...body, attachmentIds: ["other-case-att"] })).rejects.toMatchObject({ status: 400 });
    m.ticket.mockResolvedValue({ id: "case-1", jobId: null });
    await expect(raiseQaIssueFromCase("office-1", body)).rejects.toMatchObject({ status: 400 });
    expect(m.tx.qaIssue.create).not.toHaveBeenCalled();
  });
});

describe("idempotency", () => {
  it("replays the first answer for the same client key", async () => {
    m.tx.auditLog.findFirst.mockResolvedValue({ entityId: "issue-earlier" });
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ issueId: "issue-earlier", duplicate: true });
    expect(m.tx.qaIssue.create).not.toHaveBeenCalled();
  });

  it("returns the existing issue for the same case, cleaner and category inside the window, under a lock", async () => {
    m.tx.qaIssue.findFirst.mockResolvedValue({ id: "issue-earlier" });
    const result = await raiseQaIssueFromCase("office-1", { ...body, idempotencyKey: undefined });
    expect(result).toMatchObject({ issueId: "issue-earlier", duplicate: true });
    expect(m.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(m.tx.qaIssue.findFirst.mock.calls[0][0].where).toMatchObject({ itemKey: "case:case-1", cleanerId: "cleaner-1", category: "bathroom" });
    expect(m.tx.qaIssue.create).not.toHaveBeenCalled();
  });
});

describe("Quality hub shows where it came from", () => {
  it("maps a case-raised issue to raisedFromCaseId and leaves review issues alone", async () => {
    m.payRows.mockResolvedValue([]);
    const base = {
      id: "i", category: "bathroom", severity: "MAJOR", description: "d", rectificationStatus: "PENDING", rectificationMinutes: null, rectificationCost: null,
      rectificationBeforeKeys: null, rectificationAfterKeys: null, falseConfirmation: "NONE", guestReadyImpact: false, cleanerMarkedComplete: false,
      qaPhotoKeys: null, escalatedAt: null, createdAt: new Date(), updatedAt: new Date(), jobId: "job-1", propertyId: "prop-1", cleanerId: "cleaner-1",
      payAdjustmentId: null, job: null, property: null, cleaner: null, raisedBy: null, rectifiedBy: null, qaReview: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await toIssueRows([{ ...base, itemKey: "case:case-1" }, { ...base, id: "j", itemKey: "bathroom_shower" }] as any);
    expect(rows.map((row) => row.raisedFromCaseId)).toEqual(["case-1", null]);
  });
});
