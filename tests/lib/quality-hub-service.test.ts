// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  issueFindMany: vi.fn(),
  jobFindMany: vi.fn(),
  jobCount: vi.fn(),
  userFindMany: vi.fn(),
  assignmentFindMany: vi.fn(),
  assignmentCount: vi.fn(),
  reviewFindMany: vi.fn(),
  payFindMany: vi.fn(),
  coachingFindMany: vi.fn(),
  coachingCount: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/db", () => ({
  db: {
    qaIssue: { findMany: m.issueFindMany },
    job: { findMany: m.jobFindMany, count: m.jobCount },
    user: { findMany: m.userFindMany },
    qaAssignment: { findMany: m.assignmentFindMany, count: m.assignmentCount },
    qAReview: { findMany: m.reviewFindMany },
    cleanerPayAdjustment: { findMany: m.payFindMany },
    coachingRecord: { findMany: m.coachingFindMany, count: m.coachingCount },
  },
}));

import { getQualitySummary } from "@/lib/quality/summary";
import { getCleanerRows } from "@/lib/quality/cleaners";
import { getInspectorRows } from "@/lib/quality/inspectors";
import { getCategoryRows } from "@/lib/quality/categories";
import { resolveQualityPeriod } from "@/lib/quality/period";
import { EMPTY_QUALITY_FILTERS } from "@/lib/quality/types";

const NOW = new Date("2026-11-10T22:00:00Z"); // 11 Nov, Sydney morning
const at = (iso: string) => new Date(iso);

function issue(id: string, cleanerId: string, raisedById: string, category: string, severity: string, rectificationStatus = "PENDING") {
  return {
    id,
    cleanerId,
    raisedById,
    category,
    severity,
    rectificationStatus,
    falseConfirmation: "NONE",
    rectifiedById: null,
    rectificationMinutes: null,
    rectificationCost: null,
    createdAt: at("2026-11-08T00:00:00Z"),
    cleaner: { name: cleanerId === "c1" ? "Marco" : "Former Cleaner", email: "x" },
    raisedBy: { name: raisedById === "q1" ? "Dana" : "Ops", email: "y", role: raisedById === "q1" ? "QA_INSPECTOR" : "OPS_MANAGER" },
  };
}

const ISSUES = [
  issue("i1", "c1", "q1", "kitchen", "MINOR"),
  issue("i2", "c1", "q1", "linen", "CRITICAL"),
  issue("i3", "gone", "ops", "kitchen", "MAJOR", "FIXED_BY_MANAGER"),
];

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({
    accountability: {
      issueCategories: [{ key: "kitchen", label: "Kitchen" }],
      patternSameCategoryCount: 3,
      patternWindowDays: 30,
      bonuses: { streakMinScore: 97 },
    },
  });
  m.issueFindMany.mockImplementation(async (args: { select: Record<string, unknown> }) =>
    "raisedBy" in args.select ? ISSUES : [],
  );
  m.jobFindMany.mockImplementation(async (args: { take?: number }) =>
    args.take
      ? [] // streak reads: no completed, reviewed jobs
      : [
          { id: "j1", scheduledDate: at("2026-11-07T13:00:00Z"), propertyId: "p", assignments: [{ userId: "c1" }], qaReviews: [{ score: 90, kind: "QA", rating: "PASS", managementReview: false, createdAt: at("2026-11-08T00:00:00Z") }] },
          { id: "j2", scheduledDate: at("2026-11-08T13:00:00Z"), propertyId: "p", assignments: [{ userId: "c1" }], qaReviews: [] },
        ],
  );
  m.jobCount.mockResolvedValue(4);
  m.userFindMany.mockImplementation(async (args: { where: Record<string, unknown> }) =>
    "role" in args.where && args.where.role === "QA_INSPECTOR" ? [{ id: "q1", name: "Dana", email: "d", role: "QA_INSPECTOR" }, { id: "q2", name: "Idle", email: "i", role: "QA_INSPECTOR" }] : [{ id: "c1", name: "Marco", email: "m" }, { id: "c4", name: "Quiet", email: "q" }],
  );
  m.assignmentFindMany.mockResolvedValue([{ assignedToId: "q1", onSiteMinutes: 40 }, { assignedToId: "q1", onSiteMinutes: null }]);
  m.assignmentCount.mockResolvedValue(2);
  m.reviewFindMany.mockResolvedValue([]);
  m.payFindMany.mockResolvedValue([]);
  m.coachingFindMany.mockResolvedValue([]);
  m.coachingCount.mockResolvedValue(1);
});

describe("Quality hub service: the groupings read one issue query and agree", () => {
  it("cleaner, inspector, category and summary totals match for the same filters", async () => {
    const period = resolveQualityPeriod({ period: "7d" }, NOW);
    const [summary, cleaners, inspectors, categories] = await Promise.all([
      getQualitySummary(period, EMPTY_QUALITY_FILTERS, NOW),
      getCleanerRows(period, EMPTY_QUALITY_FILTERS, "score", "desc", NOW),
      getInspectorRows(period, EMPTY_QUALITY_FILTERS),
      getCategoryRows(period, EMPTY_QUALITY_FILTERS),
    ]);
    expect(summary.issuesRaised.total).toBe(3);
    expect(cleaners.issueTotal).toBe(3);
    expect(inspectors.issueTotal).toBe(3);
    expect(categories.issueTotal).toBe(3);
    // A cleaner outside the active roster with issues still gets a row, so totals reconcile.
    expect(cleaners.rows.find((row) => row.cleanerId === "gone")).toMatchObject({ active: false, name: "Former Cleaner" });
    // An active cleaner with no data shows no score rather than zero.
    expect(cleaners.rows.find((row) => row.cleanerId === "c4")).toMatchObject({ avgScore: null, cleans: 0 });
    // Inspectors: active QA roster plus everyone who raised an issue.
    expect(inspectors.rows.map((row) => row.inspectorId).sort()).toEqual(["ops", "q1", "q2"]);
    expect(inspectors.rows.find((row) => row.inspectorId === "q1")).toMatchObject({ inspectionsCompleted: 2, avgOnSiteMinutes: 40, caution: { complaintRate: null } });
  });

  it("states the clean basis and gives no score change without a previous period's reviews", async () => {
    const period = resolveQualityPeriod({ period: "7d" }, NOW);
    const summary = await getQualitySummary(period, EMPTY_QUALITY_FILTERS, NOW);
    expect(summary.cleansReviewed).toEqual({ reviewed: 1, cleans: 2 });
    expect(summary.averageScore).toMatchObject({ value: 90, sample: 1 });
    // The mocked previous period returns the same jobs, which fall outside it: no data, no delta.
    expect(summary.averageScore.previousSample).toBe(0);
    expect(summary.averageScore.delta).toBeNull();
    expect(summary.fixCost).toEqual({ amount: null, minutes: null, fixesWithCost: 0 });
    expect(summary.tabs).toMatchObject({ inspections: 2, quickScore: 4, reviewQueue: 6, issues: 3, coaching: 1 });
  });

  it("hides cleaners without matching issues when an issue-level filter is on", async () => {
    const period = resolveQualityPeriod({ period: "7d" }, NOW);
    const result = await getCleanerRows(period, { ...EMPTY_QUALITY_FILTERS, openFixes: true }, "issues", "desc", NOW);
    expect(result.rows.map((row) => row.cleanerId)).toEqual(["c1", "gone"]);
    // The streak for a cleaner with no completed, reviewed jobs is "no data", not a zero streak.
    expect(result.rows[0].streak).toEqual({ currentStreak: 0, last5Avg: null, last10Avg: null, sample: 0 });
    // Streaks cost one query per visible cleaner (not getPerformanceMetrics per cleaner).
    const streakReads = m.jobFindMany.mock.calls.filter(([args]) => args.take === 10);
    expect(streakReads).toHaveLength(2);
  });
});
