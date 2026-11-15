// @vitest-environment node
/**
 * Inspection record reads (lib/quality/inspection-record.ts) and the office-only
 * Inspectors figures: an inspector reads only an inspection assigned to them
 * (nothing else is read for anyone else), the record reads stored facts only,
 * and the Inspectors route stays ADMIN / OPS_MANAGER (owner default: QA
 * inspectors never see other inspectors' figures).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  assignment: vi.fn(),
  qaSubmission: vi.fn(),
  review: vi.fn(),
  reviews: vi.fn(),
  issues: vi.fn(),
  formSubmission: vi.fn(),
  jobs: vi.fn(),
  transfers: vi.fn(),
  adjustment: vi.fn(),
  users: vi.fn(),
  aiReviews: vi.fn(),
  requireRole: vi.fn(),
  inspectorRows: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    qaAssignment: { findUnique: m.assignment },
    qaFormSubmission: { findFirst: m.qaSubmission },
    qAReview: { findUnique: m.review, findMany: m.reviews },
    qaIssue: { findMany: m.issues },
    formSubmission: { findFirst: m.formSubmission },
    job: { findMany: m.jobs },
    qaReworkTransfer: { findMany: m.transfers },
    cleanerPayAdjustment: { findFirst: m.adjustment },
    user: { findMany: m.users },
    aiPhotoReview: { findMany: m.aiReviews },
  },
}));
vi.mock("@/lib/settings", () => ({
  getAppSettings: async () => ({ timezone: "Australia/Sydney", accountability: { issueCategories: [{ key: "kitchen", label: "Kitchen detail" }] } }),
}));
vi.mock("@/lib/qa/reopen-facts", () => ({ collectReopenMoneyFacts: async () => ({ reworkJobs: 0, adjustments: [], issueCount: 0 }) }));
vi.mock("@/lib/qa/reopen", async (original) => ({ ...(await original<typeof import("@/lib/qa/reopen")>()), reopenMoneyWarnings: () => [] }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/quality/inspectors", () => ({ getInspectorRows: m.inspectorRows }));

import { loadInspectionRecord } from "@/lib/quality/inspection-record";
import { GET as inspectorsGet } from "@/app/api/admin/quality/inspectors/route";
import { NextRequest } from "next/server";

const ASSIGNMENT = {
  id: "assign-1", jobId: "job-1", assignedToId: "dana", pickedUpById: null, status: "COMPLETED", verdictScale: "FAIL",
  completedAt: new Date("2026-11-11T03:58:00Z"), checkInAt: new Date("2026-11-11T03:20:00Z"), checkInLat: -33.8, checkInSkippedReason: null,
  reworkOfferStatus: null, reworkOfferedAt: null, reworkOfferExpiresAt: null,
  assignedTo: { name: "Dana Whitfield", email: "d@x" }, pickedUpBy: null,
  job: { id: "job-1", jobNumber: "J-1031", jobType: "AIRBNB_TURNOVER", status: "COMPLETED", scheduledDate: new Date("2026-11-10T13:00:00Z"), property: { name: "Glebe House" }, assignments: [{ user: { id: "marco", name: "Marco Rossi", email: "m@x" } }] },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.assignment.mockResolvedValue(ASSIGNMENT);
  m.qaSubmission.mockResolvedValue({ id: "qs-1", qaReviewId: "rev-1", createdAt: new Date(), templateSnapshot: { sections: [{ id: "k", title: "Kitchen", fields: [{ id: "oven", label: "Oven cleaned inside" }] }] }, templateSnapshotName: "QA turnover", template: null, submittedBy: { name: "Dana Whitfield" }, data: {} });
  m.review.mockResolvedValue({ id: "rev-1", score: 84, rawScore: 84, rating: "PASS", passed: true, managementReview: false, adjustmentReason: null });
  m.reviews.mockResolvedValue([{ id: "rev-1", kind: "QA", createdAt: new Date() }]);
  m.issues.mockImplementation(async ({ where }: { where: { qaReviewId?: string } }) =>
    where.qaReviewId
      ? [{ id: "i1", fieldId: "oven", cleanerId: "marco", category: "kitchen", description: "Residue", severity: "MINOR", failVerdict: false, serious: false, falseConfirmation: "SUSPECTED", rectificationStatus: "PENDING", cleanerMarkedComplete: true, guestReadyImpact: false, qaPhotoKeys: [], cleanerMediaIds: ["m-oven"] }]
      : [],
  );
  m.formSubmission.mockResolvedValue(null);
  m.jobs.mockResolvedValue([]);
  m.transfers.mockResolvedValue([]);
  m.adjustment.mockResolvedValue(null);
  m.users.mockResolvedValue([]);
  m.aiReviews.mockResolvedValue([]);
});

describe("loadInspectionRecord", () => {
  it("refuses an inspector who is not on the inspection before reading anything else", async () => {
    expect(await loadInspectionRecord("assign-1", { id: "mei", role: "QA_INSPECTOR" })).toBeNull();
    expect(m.qaSubmission).not.toHaveBeenCalled();
    expect(m.issues).not.toHaveBeenCalled();
  });

  it("reads the record for the assigned inspector and for an admin, from stored facts only", async () => {
    expect(await loadInspectionRecord("assign-1", { id: "dana", role: "QA_INSPECTOR" })).not.toBeNull();
    const record = await loadInspectionRecord("assign-1", { id: "admin", role: "ADMIN" });
    expect(record).toMatchObject({
      propertyName: "Glebe House",
      jobNumber: "J-1031",
      serviceDate: "2026-11-11",
      issueCount: 1,
      score: { score: 84, ratingLabel: "Pass" },
      ai: { scoreReviewId: "rev-1", coveredFieldIds: ["oven"], coveredMediaIds: ["m-oven"], deductedAnalysisIds: [] },
      evidence: null,
      reopen: { eligible: true },
    });
    expect(record?.areas[0].items[0].issue).toMatchObject({ verdictLabel: "Minor", falseConfirmation: "SUSPECTED" });
  });

  it("is null when no inspection form was submitted (the page then opens the workspace)", async () => {
    m.qaSubmission.mockResolvedValue(null);
    expect(await loadInspectionRecord("assign-1", { id: "admin", role: "ADMIN" })).toBeNull();
  });
});

describe("Inspectors figures are office only", () => {
  it("guards the route with ADMIN and OPS_MANAGER and refuses before reading figures", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await inspectorsGet(new NextRequest("http://localhost/api/admin/quality/inspectors?period=30d"));
    expect(response.status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.inspectorRows).not.toHaveBeenCalled();
  });
});
