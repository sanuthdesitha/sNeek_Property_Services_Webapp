import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    jobAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    staffDocument: { findMany: vi.fn().mockResolvedValue([]) },
    learningAssignment: { findMany: vi.fn().mockResolvedValue([]) },
    qaReworkTransfer: { findMany: vi.fn().mockResolvedValue([]) },
    job: { findMany: vi.fn().mockResolvedValue([]) },
    appSetting: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

import { db } from "@/lib/db";
import { getPerformanceMetrics, performanceWindow } from "@/lib/workforce/performance";

const NOW = new Date("2026-11-15T02:00:00.000Z"); // 1 pm, 15 Nov 2026, Sydney (AEDT)

function job(overrides: Record<string, unknown>) {
  return {
    id: "job",
    status: "COMPLETED",
    scheduledDate: new Date("2026-11-10T00:00:00.000Z"),
    startTime: "09:00",
    cleanSkipStatus: "NONE",
    timeLogs: [],
    formSubmissions: [],
    qaReviews: [],
    issueTickets: [],
    feedback: null,
    satisfactionRating: null,
    ...overrides,
  };
}

describe("getPerformanceMetrics (loader)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.jobAssignment.findMany as any).mockResolvedValue([]);
    (db.staffDocument.findMany as any).mockResolvedValue([]);
    (db.learningAssignment.findMany as any).mockResolvedValue([]);
    (db.qaReworkTransfer.findMany as any).mockResolvedValue([]);
    (db.job.findMany as any).mockResolvedValue([]);
  });

  it("returns nulls and zero counts when no data exists", async () => {
    const m = await getPerformanceMetrics("user-1", 30, NOW);
    expect(m.userId).toBe("user-1");
    expect(m.windowDays).toBe(30);
    expect(m.finishedJobs).toBe(0);
    expect(m.minimumSample).toBe(3);
    for (const value of [
      m.quality.score,
      m.reliability.onTimePercent,
      m.punctuality.avgMinutesLate,
      m.attendance.percent,
      m.documentation.fullyDocumentedPercent,
      m.customerSatisfaction.avgRating,
      m.responseRate.acceptedPercent,
      m.disputeRate.percent,
      m.noShowRate.percent,
      m.documentCompliance.percent,
      m.trainingCompletion.percent,
      m.reworkRate.percent,
    ]) {
      expect(value).toBeNull();
    }
  });

  it("windows on Sydney days, today included", () => {
    const window = performanceWindow(30, NOW);
    expect(window.todayKey).toBe("2026-11-15");
    expect(window.start.toISOString()).toBe("2026-10-16T13:00:00.000Z"); // 17 Oct, Sydney midnight (AEDT)
    expect(window.end.toISOString()).toBe("2026-11-15T13:00:00.000Z"); // 16 Nov, Sydney midnight
  });

  it("reads only jobs the cleaner is still on, scheduled in the window, with their own clock-ins and client disputes only", async () => {
    await getPerformanceMetrics("user-1", 30, NOW);
    const jobQuery = (db.job.findMany as any).mock.calls[0][0];
    expect(jobQuery.where.assignments).toEqual({ some: { userId: "user-1", removedAt: null } });
    expect(jobQuery.where.scheduledDate.gte.toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(jobQuery.where.scheduledDate.lt.toISOString()).toBe("2026-11-15T13:00:00.000Z");
    expect(jobQuery.select.timeLogs.where).toEqual({ userId: "user-1" });
    expect(jobQuery.select.issueTickets.where).toEqual({ caseType: "CLIENT_DISPUTE", state: { not: "CANCELLED" } });
    const offerQuery = (db.jobAssignment.findMany as any).mock.calls[0][0];
    expect(offerQuery.where.userId).toBe("user-1");
    expect(offerQuery.where.offeredAt.gte.toISOString()).toBe("2026-10-16T13:00:00.000Z");
  });

  it("works the figures from the rows: a finished job without a form is not documented", async () => {
    (db.job.findMany as any).mockImplementation(async (args: any) =>
      args.take
        ? []
        : [
            job({ id: "a", formSubmissions: [{ submittedById: "user-1", _count: { media: 4 } }] }),
            job({ id: "b" }),
            job({ id: "c" }),
          ],
    );
    const m = await getPerformanceMetrics("user-1", 30, NOW);
    expect(m.finishedJobs).toBe(3);
    expect(m.documentation).toMatchObject({ documented: 1, withoutForm: 2, sampleSize: 3, fullyDocumentedPercent: 33 });
    expect(m.reworkRate.totalJobs).toBe(3);
  });

  it("does not turn a failed job read into zeros: the window fails", async () => {
    (db.job.findMany as any).mockRejectedValue(new Error("missing table"));
    await expect(getPerformanceMetrics("user-1", 30, NOW)).rejects.toThrow("missing table");
  });

  it("documents current: rejected ones are not on file, EXPIRED status or a past date is expired", async () => {
    const future = new Date(NOW.getTime() + 30 * 86_400_000);
    const past = new Date(NOW.getTime() - 30 * 86_400_000);
    (db.staffDocument.findMany as any).mockResolvedValue([
      { expiresAt: future, status: "VERIFIED" },
      { expiresAt: future, status: "VERIFIED" },
      { expiresAt: past, status: "VERIFIED" },
      { expiresAt: null, status: "VERIFIED" },
      { expiresAt: null, status: "EXPIRED" },
      { expiresAt: future, status: "REJECTED" },
    ]);
    const m = await getPerformanceMetrics("user-1", 30, NOW);
    expect(m.documentCompliance).toEqual({ current: 3, expired: 2, percent: 60 });
  });

  it("a failed side read (documents) keeps the job figures and leaves documents empty", async () => {
    (db.staffDocument.findMany as any).mockRejectedValue(new Error("boom"));
    const m = await getPerformanceMetrics("user-1", 30, NOW);
    expect(m.documentCompliance.percent).toBeNull();
    expect(m.finishedJobs).toBe(0);
  });
});
