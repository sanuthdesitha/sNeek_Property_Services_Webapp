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
import { inspectionQueueCounters, organisationDayBounds } from "@/lib/quality/inspections";
import { ratingMixByCleaner, managementReviewCount, type CleanFact } from "@/lib/quality/cleans";
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

describe("parity audit 2026-11-12: rating mix, management review count, queue counters", () => {
  const range = { start: at("2026-11-01T00:00:00Z"), end: at("2026-11-11T00:00:00Z") };
  const clean = (jobId: string, cleanerIds: string[], review: CleanFact["review"], day = "2026-11-05T00:00:00Z"): CleanFact => ({
    jobId,
    scheduledDate: at(day),
    propertyId: "p",
    cleanerIds,
    review,
  });
  const review = (rating: string | null, managementReview = false) => ({ score: 90, rating, managementReview, createdAt: at("2026-11-05T00:00:00Z") });

  it("counts each cleaner's reviewed cleans by rating band with the old overview's rule", () => {
    const cleans = [
      clean("a", ["c1"], review("EXCELLENT")),
      clean("b", ["c1", "c2"], review("PASS")),
      clean("c", ["c1"], review("PASS", true)), // flagged: counted as Mgmt review, not Pass
      clean("d", ["c1"], review(null)), // no rating: kept apart, never folded into a band
      clean("e", ["c1"], null), // not reviewed
      clean("f", ["c1"], review("FAILED"), "2026-10-01T00:00:00Z"), // outside the period
    ];
    const mixes = ratingMixByCleaner(cleans, range);
    expect(mixes.get("c1")).toEqual({ EXCELLENT: 1, PASS: 1, NEEDS_IMPROVEMENT: 0, FAILED: 0, MANAGEMENT_REVIEW: 1, unrated: 1 });
    expect(mixes.get("c2")).toEqual({ EXCELLENT: 0, PASS: 1, NEEDS_IMPROVEMENT: 0, FAILED: 0, MANAGEMENT_REVIEW: 0, unrated: 0 });
    // Each clean counts once for the company figure.
    expect(managementReviewCount([...cleans, clean("g", ["c1", "c2"], review("MANAGEMENT_REVIEW"))], range)).toBe(2);
  });

  it("puts the rating mix on the cleaner row and the management review count on the summary", async () => {
    const period = resolveQualityPeriod({ period: "7d" }, NOW);
    const [summary, cleaners] = await Promise.all([
      getQualitySummary(period, EMPTY_QUALITY_FILTERS, NOW),
      getCleanerRows(period, EMPTY_QUALITY_FILTERS, "score", "desc", NOW),
    ]);
    expect(cleaners.rows.find((row) => row.cleanerId === "c1")?.ratingMix).toMatchObject({ PASS: 1, MANAGEMENT_REVIEW: 0 });
    expect(cleaners.rows.find((row) => row.cleanerId === "c4")?.ratingMix).toEqual({ EXCELLENT: 0, PASS: 0, NEEDS_IMPROVEMENT: 0, FAILED: 0, MANAGEMENT_REVIEW: 0, unrated: 0 });
    expect(summary.managementReview).toEqual({ count: 0 });
  });

  it("takes 'today' in the organisation's timezone, across daylight saving", () => {
    // 10 Nov 22:00 UTC is 11 Nov 09:00 in Sydney (AEDT, +11).
    expect(organisationDayBounds(NOW, "Australia/Sydney")).toEqual({ start: at("2026-11-10T13:00:00Z"), end: at("2026-11-11T13:00:00Z") });
    // The day DST starts in Sydney (4 Oct 2026) is 23 hours long.
    const dst = organisationDayBounds(at("2026-10-04T05:00:00Z"), "Australia/Sydney");
    expect((dst.end.getTime() - dst.start.getTime()) / 3_600_000).toBe(23);
    expect(organisationDayBounds(NOW, "Australia/Perth").start).toEqual(at("2026-11-10T16:00:00Z"));
  });

  it("counts awaiting, in-progress and completed-today inspections with the organisation's timezone", async () => {
    m.settings.mockResolvedValue({ timezone: "Australia/Perth", accountability: { issueCategories: [] } });
    m.assignmentCount.mockImplementation(async (args: { where: { status: unknown } }) => {
      const status = args.where.status;
      if (status === "IN_PROGRESS") return 2;
      if (status === "COMPLETED") return 5;
      return 3;
    });
    const counters = await inspectionQueueCounters({ ...EMPTY_QUALITY_FILTERS, propertyId: "p9" }, NOW);
    expect(counters).toEqual({ awaiting: 3, inProgress: 2, completedToday: 5, timeZone: "Australia/Perth" });
    const calls = m.assignmentCount.mock.calls.map(([args]) => args.where);
    expect(calls[0]).toMatchObject({ status: { in: ["OPEN", "ASSIGNED"] }, job: expect.anything() });
    expect(calls[2]).toMatchObject({ status: "COMPLETED", completedAt: { gte: at("2026-11-10T16:00:00Z"), lt: at("2026-11-11T16:00:00Z") } });
  });
});
