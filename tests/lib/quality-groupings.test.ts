import { describe, expect, it } from "vitest";
import {
  groupIssuesByCategory,
  groupIssuesByCleaner,
  groupIssuesByInspector,
  groupQaFixesByRectifier,
  issueTotals,
  type IssueFact,
} from "@/lib/quality/groupings";
import { cleanTotals, cleanTotalsByCleaner, trendWeekKeys, weeklyTrend, type CleanFact } from "@/lib/quality/cleans";
import { rangeFromKeys } from "@/lib/quality/period";
import { pickAuthoritativeReview } from "@/lib/quality/authority";
import { cleanerAction, strongestPatterns } from "@/lib/quality/cleaner-signals";

const NOW = new Date("2026-11-11T00:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function issue(partial: Partial<IssueFact> & Pick<IssueFact, "id">): IssueFact {
  return {
    cleanerId: "c1",
    cleanerName: "Marco",
    raisedById: "q1",
    raisedByName: "Dana",
    raisedByRole: "QA_INSPECTOR",
    category: "kitchen",
    severity: "MINOR",
    rectificationStatus: "PENDING",
    falseConfirmation: "NONE",
    rectifiedById: null,
    rectificationMinutes: null,
    rectificationCost: null,
    createdAt: hoursAgo(10),
    ...partial,
  };
}

const ISSUES: IssueFact[] = [
  issue({ id: "i1", severity: "CRITICAL", category: "linen", createdAt: hoursAgo(52) }),
  issue({ id: "i2", severity: "MAJOR", falseConfirmation: "SUSPECTED" }),
  issue({ id: "i3", cleanerId: "c2", cleanerName: "Jane", category: "bathroom", rectificationStatus: "FIXED_BY_QA", rectifiedById: "q2", rectificationMinutes: 30, rectificationCost: 25 }),
  issue({ id: "i4", cleanerId: "c2", cleanerName: "Jane", raisedById: "q2", raisedByName: "Lee", category: "kitchen", rectificationStatus: "FIXED_BY_MANAGER", rectificationMinutes: 15 }),
  issue({ id: "i5", cleanerId: "c3", cleanerName: "Aiko", raisedById: "admin", raisedByName: "Ops", raisedByRole: "OPS_MANAGER", category: "linen", falseConfirmation: "CONFIRMED", rectificationStatus: "ESCALATED" }),
];
const labelFor = (key: string) => ({ linen: "Linen and beds", kitchen: "Kitchen", bathroom: "Bathroom detail" })[key] ?? key;

describe("Quality groupings over one issue set", () => {
  it("agree with each other and with the totals", () => {
    const totals = issueTotals(ISSUES, NOW);
    const byCleaner = Array.from(groupIssuesByCleaner(ISSUES, labelFor).values());
    const byInspector = Array.from(groupIssuesByInspector(ISSUES).values());
    const byCategory = groupIssuesByCategory(ISSUES, labelFor);

    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(totals.total).toBe(5);
    expect(sum(byCleaner.map((row) => row.total))).toBe(totals.total);
    expect(sum(byInspector.map((row) => row.found.total))).toBe(totals.total);
    expect(sum(byCategory.map((row) => row.total))).toBe(totals.total);
    expect(sum(byCategory.flatMap((row) => row.cleaners.map((cleaner) => cleaner.count)))).toBe(totals.total);
    // Severity and open-fix splits reconcile too.
    expect(sum(byCleaner.map((row) => row.bySeverity.CRITICAL))).toBe(totals.bySeverity.CRITICAL);
    expect(sum(byCleaner.map((row) => row.openFixes))).toBe(totals.openFixes);
    expect(sum(byCategory.map((row) => row.openFixes))).toBe(totals.openFixes);
  });

  it("uses the existing definitions for open fixes, flags and QA fixes", () => {
    const totals = issueTotals(ISSUES, NOW);
    expect(totals.openFixes).toBe(3); // PENDING, PENDING, ESCALATED
    expect(totals.openOver48h).toBe(1);
    expect(totals.fixCost).toBe(25);
    expect(totals.fixMinutes).toBe(45);

    const marco = groupIssuesByCleaner(ISSUES, labelFor).get("c1")!;
    expect(marco.falseConfirmations).toEqual({ suspected: 1, confirmed: 0 });
    expect(marco.categories[0]).toEqual({ category: "kitchen", label: "Kitchen", count: 1 });

    const dana = groupIssuesByInspector(ISSUES).get("q1")!;
    expect(dana.found).toEqual({ MINOR: 1, MAJOR: 1, CRITICAL: 1, total: 3 });
    expect(dana.flagsRaised).toBe(1);
    expect(groupIssuesByInspector(ISSUES).get("admin")!.flagsRaised).toBe(1);

    // Credited to the recorded rectifier, not the raiser.
    expect(groupQaFixesByRectifier(ISSUES).get("q2")).toEqual({ count: 1, minutes: 30, cost: 25 });
    expect(groupQaFixesByRectifier(ISSUES).has("q1")).toBe(false);

    const linen = groupIssuesByCategory(ISSUES, labelFor).find((row) => row.category === "linen")!;
    expect(linen.cleaners.map((c) => c.name).sort()).toEqual(["Aiko", "Marco"]);
  });

  it("reports no number when nothing was recorded", () => {
    const totals = issueTotals([issue({ id: "x" })], NOW);
    expect(totals.fixCost).toBeNull();
    expect(totals.fixMinutes).toBeNull();
    expect(issueTotals([], NOW)).toMatchObject({ total: 0, fixCost: null, fixMinutes: null });
  });
});

describe("Clean figures", () => {
  const review = (score: number) => ({ score, rating: null, managementReview: false, createdAt: NOW });
  const day = (key: string) => new Date(`${key}T00:00:00+11:00`);
  const CLEANS: CleanFact[] = [
    { jobId: "j1", scheduledDate: day("2026-11-10"), propertyId: "p", cleanerIds: ["c1", "c2"], review: review(90) },
    { jobId: "j2", scheduledDate: day("2026-11-09"), propertyId: "p", cleanerIds: ["c1"], review: review(80) },
    { jobId: "j3", scheduledDate: day("2026-11-08"), propertyId: "p", cleanerIds: ["c2"], review: null },
    { jobId: "j4", scheduledDate: day("2026-10-01"), propertyId: "p", cleanerIds: ["c1"], review: review(50) },
  ];
  const period = rangeFromKeys("2026-11-05", "2026-11-11");

  it("counts cleans, reviews and the average for the period only", () => {
    expect(cleanTotals(CLEANS, period)).toEqual({ cleans: 3, reviewed: 2, avgScore: 85 });
    expect(cleanTotals([], period)).toEqual({ cleans: 0, reviewed: 0, avgScore: null });
    const byCleaner = cleanTotalsByCleaner(CLEANS, period);
    expect(byCleaner.get("c1")).toEqual({ cleans: 2, reviewed: 2, avgScore: 85 });
    expect(byCleaner.get("c2")).toEqual({ cleans: 2, reviewed: 1, avgScore: 90 });
  });

  it("draws eight Sydney weeks with gaps, never zeros", () => {
    expect(trendWeekKeys("2026-11-11")).toHaveLength(8);
    expect(trendWeekKeys("2026-11-11").at(-1)).toBe("2026-11-09");
    const trend = weeklyTrend(CLEANS, "2026-11-11", "c1");
    expect(trend.at(-1)).toEqual({ weekStart: "2026-11-09", avgScore: 85, reviewed: 2 });
    expect(trend.filter((point) => point.avgScore === null)).toHaveLength(6);
    expect(trend.some((point) => point.avgScore === 0)).toBe(false);
  });

  it("picks the authoritative review: QA over ADMIN over AUTO, then latest", () => {
    const at = (iso: string) => new Date(iso);
    const reviews = [
      { kind: "AUTO", createdAt: at("2026-11-10T00:00:00Z"), score: 70 },
      { kind: "QA", createdAt: at("2026-11-01T00:00:00Z"), score: 92 },
      { kind: "ADMIN", createdAt: at("2026-11-11T00:00:00Z"), score: 80 },
    ];
    expect(pickAuthoritativeReview(reviews)?.score).toBe(92);
    expect(pickAuthoritativeReview([])).toBeNull();
  });
});

describe("Cleaner row action signals", () => {
  it("suggests coaching from the existing pattern rule, with the issues behind it", () => {
    const issues = [1, 2, 3].map((n) => ({ id: `p${n}`, cleanerId: "c1", propertyId: "p", category: "kitchen", severity: "MINOR", createdAt: hoursAgo(n * 24) }));
    const map = strongestPatterns(issues, { sameCategoryCount: 3, windowDays: 30, now: NOW }, labelFor);
    expect(map.get("c1")).toMatchObject({ category: "kitchen", label: "Kitchen", count: 3, issueIds: ["p1", "p2", "p3"], patternKey: "cleaner:c1:kitchen" });
    expect(strongestPatterns(issues.slice(0, 2), { sameCategoryCount: 3, windowDays: 30, now: NOW }, labelFor).size).toBe(0);
  });

  it("offers one action: coaching (when none is open) before a waiting bonus", () => {
    const suggestion = { category: "k", label: "K", count: 3, windowDays: 30, patternKey: "x", issueIds: [] };
    expect(cleanerAction({ suggestion, openCoaching: 0, bonuses: 1 })).toBe("start-coaching");
    expect(cleanerAction({ suggestion, openCoaching: 1, bonuses: 1 })).toBe("review-bonus");
    expect(cleanerAction({ suggestion: null, openCoaching: 0, bonuses: 0 })).toBeNull();
  });
});
