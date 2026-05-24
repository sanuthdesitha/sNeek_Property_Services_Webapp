import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    qaFormSubmission: { findMany: vi.fn().mockResolvedValue([]) },
    jobAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    timeLog: { findMany: vi.fn().mockResolvedValue([]) },
    formSubmission: { findMany: vi.fn().mockResolvedValue([]) },
    jobFeedback: { findMany: vi.fn().mockResolvedValue([]) },
    clientSatisfactionRating: { findMany: vi.fn().mockResolvedValue([]) },
    staffDocument: { findMany: vi.fn().mockResolvedValue([]) },
    learningAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    issueTicket: { count: vi.fn().mockResolvedValue(0) },
  },
}));

import { db } from "@/lib/db";
import { getPerformanceMetrics } from "@/lib/workforce/performance";

describe("getPerformanceMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.qaFormSubmission.findMany as any).mockResolvedValue([]);
    (db.jobAssignment.findMany as any).mockResolvedValue([]);
    (db.timeLog.findMany as any).mockResolvedValue([]);
    (db.formSubmission.findMany as any).mockResolvedValue([]);
    (db.jobFeedback.findMany as any).mockResolvedValue([]);
    (db.clientSatisfactionRating.findMany as any).mockResolvedValue([]);
    (db.staffDocument.findMany as any).mockResolvedValue([]);
    (db.learningAssignment.findMany as any).mockResolvedValue([]);
    (db.issueTicket.count as any).mockResolvedValue(0);
  });

  it("returns nulls and zero counts when no data exists", async () => {
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.userId).toBe("user-1");
    expect(m.windowDays).toBe(30);
    expect(m.windowStart).toBeInstanceOf(Date);

    expect(m.quality.score).toBeNull();
    expect(m.quality.sampleSize).toBe(0);
    expect(m.reliability.onTimePercent).toBeNull();
    expect(m.punctuality.avgMinutesLate).toBeNull();
    expect(m.attendance.percent).toBeNull();
    expect(m.attendance.assignedJobs).toBe(0);
    expect(m.documentation.fullyDocumentedPercent).toBeNull();
    expect(m.customerSatisfaction.avgRating).toBeNull();
    expect(m.responseRate.acceptedPercent).toBeNull();
    expect(m.disputeRate.percent).toBeNull();
    expect(m.noShowRate.percent).toBeNull();
    expect(m.documentCompliance.percent).toBeNull();
    expect(m.trainingCompletion.percent).toBeNull();
  });

  it("computes quality score as average of QA submissions", async () => {
    (db.qaFormSubmission.findMany as any).mockResolvedValue([
      { score: 80 },
      { score: 90 },
      { score: 100 },
    ]);
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.quality.score).toBe(90);
    expect(m.quality.sampleSize).toBe(3);
  });

  it("computes attendance as completed / assigned", async () => {
    (db.jobAssignment.findMany as any).mockResolvedValue([
      { job: { status: "COMPLETED" }, offeredAt: null, respondedAt: null },
      { job: { status: "COMPLETED" }, offeredAt: null, respondedAt: null },
      { job: { status: "ASSIGNED" }, offeredAt: null, respondedAt: null },
      { job: { status: "ASSIGNED" }, offeredAt: null, respondedAt: null },
    ]);
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.attendance.completedJobs).toBe(2);
    expect(m.attendance.assignedJobs).toBe(4);
    expect(m.attendance.percent).toBe(50);
  });

  it("computes reliability as on-time arrivals within 15 minutes", async () => {
    const sched = new Date("2026-05-01T10:00:00Z");
    const onTime = new Date("2026-05-01T10:10:00Z");
    const late = new Date("2026-05-01T10:30:00Z");
    (db.jobAssignment.findMany as any).mockResolvedValue([
      {
        job: { status: "COMPLETED", scheduledDate: sched, startTime: "10:00", arrivedAt: onTime },
        offeredAt: null,
        respondedAt: null,
      },
      {
        job: { status: "COMPLETED", scheduledDate: sched, startTime: "10:00", arrivedAt: late },
        offeredAt: null,
        respondedAt: null,
      },
    ]);
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.reliability.sampleSize).toBe(2);
    expect(m.reliability.onTimePercent).toBe(50);
  });

  it("merges JobFeedback and ClientSatisfactionRating into a single customer satisfaction average", async () => {
    (db.jobFeedback.findMany as any).mockResolvedValue([{ rating: 5 }, { rating: 4 }]);
    (db.clientSatisfactionRating.findMany as any).mockResolvedValue([{ score: 3 }]);
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.customerSatisfaction.sampleSize).toBe(3);
    expect(m.customerSatisfaction.avgRating).toBeCloseTo(4, 1);
  });

  it("treats document compliance correctly with mixed expiry", async () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    (db.staffDocument.findMany as any).mockResolvedValue([
      { expiresAt: future, status: "VERIFIED" },
      { expiresAt: future, status: "VERIFIED" },
      { expiresAt: past, status: "VERIFIED" },
      { expiresAt: null, status: "VERIFIED" }, // no expiry = current
    ]);
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.documentCompliance.current).toBe(3);
    expect(m.documentCompliance.expired).toBe(1);
    expect(m.documentCompliance.percent).toBe(75);
  });

  it("degrades gracefully when a model throws", async () => {
    (db.qaFormSubmission.findMany as any).mockRejectedValue(new Error("missing table"));
    const m = await getPerformanceMetrics("user-1", 30);
    expect(m.quality.score).toBeNull();
    expect(m.quality.sampleSize).toBe(0);
  });
});
