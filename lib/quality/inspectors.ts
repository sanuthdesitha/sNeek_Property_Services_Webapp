/**
 * Inspectors tab: the QA performance figures, per inspector, over the hub's
 * period and filters. Definitions are unchanged from the QA performance route:
 *
 * - roster = active QA_INSPECTOR accounts plus anyone who raised an issue in
 *   the filtered set (so issue totals always reconcile with the Issues tab);
 * - inspections = COMPLETED QaAssignments completed in the period;
 * - fixed by QA = FIXED_BY_QA issues credited to their recorded rectifier;
 * - caution = complaint rate on jobs the inspector QA-passed in the period
 *   that later drew client feedback of 2 or less (null with no passed jobs).
 */
import { QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadCategoryLabels, loadIssueFacts } from "./facts";
import { groupIssuesByInspector, groupQaFixesByRectifier, type SeverityCounts } from "./groupings";
import type { PeriodRange } from "./period";
import type { InspectorSort, QualityFilters } from "./types";

export const INSPECTOR_SCORING_NOTE =
  "Issue quantity alone is not rewarded — balance found vs fix quality vs misses.";

export type InspectorRow = {
  inspectorId: string;
  name: string;
  role: string;
  inspectionsCompleted: number;
  avgOnSiteMinutes: number | null;
  issuesFound: SeverityCounts & { total: number };
  issuesFixedByQA: number;
  rectificationMinutes: number;
  rectificationCost: number;
  falseConfirmationsRaised: number;
  caution: { passedJobs: number; complaints: number; complaintRate: number | null };
};

export type InspectorRowsResult = { rows: InspectorRow[]; issueTotal: number; note: string };

function dateFilter(range: PeriodRange) {
  return range.start ? { gte: range.start, lt: range.end } : { lt: range.end };
}

function sortValue(row: InspectorRow, sort: InspectorSort): string | number | null {
  switch (sort) {
    case "inspector":
      return row.name.toLowerCase();
    case "inspections":
      return row.inspectionsCompleted;
    case "onSite":
      return row.avgOnSiteMinutes;
    case "issues":
      return row.issuesFound.total;
    case "fixed":
      return row.issuesFixedByQA;
    case "rectificationCost":
      return row.rectificationCost;
    case "flags":
      return row.falseConfirmationsRaised;
    case "complaintRate":
      return row.caution.complaintRate;
  }
}

export function sortInspectorRows(rows: InspectorRow[], sort: InspectorSort, dir: "asc" | "desc"): InspectorRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left !== right) return (left < right ? -1 : 1) * factor;
    return a.name.localeCompare(b.name);
  });
}

export async function getInspectorRows(
  range: PeriodRange,
  filters: QualityFilters,
  sort: InspectorSort = "issues",
  dir: "asc" | "desc" = "desc",
): Promise<InspectorRowsResult> {
  const labels = await loadCategoryLabels();
  const jobNarrow = filters.propertyId ? { job: { propertyId: filters.propertyId } } : {};
  const [issues, inspectorUsers, assignments, passedReviews] = await Promise.all([
    loadIssueFacts(range, filters, labels),
    db.user.findMany({ where: { role: Role.QA_INSPECTOR, isActive: true }, select: { id: true, name: true, email: true, role: true } }),
    db.qaAssignment.findMany({
      where: { status: QaAssignmentStatus.COMPLETED, completedAt: dateFilter(range), ...jobNarrow },
      select: { assignedToId: true, onSiteMinutes: true },
    }),
    db.qAReview.findMany({
      where: { createdAt: dateFilter(range), kind: "QA", passed: true, reviewedById: { not: null }, ...jobNarrow },
      select: {
        reviewedById: true,
        job: { select: { feedback: { select: { rating: true } }, satisfactionRating: { select: { score: true } } } },
      },
    }),
  ]);

  const found = groupIssuesByInspector(issues);
  const fixes = groupQaFixesByRectifier(issues);
  const roster = new Map<string, InspectorRow>();
  const ensure = (id: string, name: string, role: string) => {
    if (!roster.has(id)) {
      roster.set(id, {
        inspectorId: id,
        name,
        role,
        inspectionsCompleted: 0,
        avgOnSiteMinutes: null,
        issuesFound: { MINOR: 0, MAJOR: 0, CRITICAL: 0, total: 0 },
        issuesFixedByQA: 0,
        rectificationMinutes: 0,
        rectificationCost: 0,
        falseConfirmationsRaised: 0,
        caution: { passedJobs: 0, complaints: 0, complaintRate: null },
      });
    }
    return roster.get(id)!;
  };

  // With an issue-level filter or a person filter, only inspectors behind the matching issues are shown.
  const issueScoped = Boolean(filters.raisedById || filters.category || filters.openFixes || filters.cleanerId || filters.q.trim());
  if (!issueScoped) for (const user of inspectorUsers) ensure(user.id, user.name ?? user.email ?? "Inspector", user.role);
  for (const summary of Array.from(found.values())) {
    const row = ensure(summary.inspectorId, summary.name, summary.role);
    row.issuesFound = { ...summary.found };
    row.falseConfirmationsRaised = summary.flagsRaised;
  }

  const onSite = new Map<string, { sum: number; n: number }>();
  for (const assignment of assignments) {
    const row = assignment.assignedToId ? roster.get(assignment.assignedToId) : undefined;
    if (!row) continue;
    row.inspectionsCompleted += 1;
    if (typeof assignment.onSiteMinutes === "number") {
      const acc = onSite.get(row.inspectorId) ?? { sum: 0, n: 0 };
      acc.sum += assignment.onSiteMinutes;
      acc.n += 1;
      onSite.set(row.inspectorId, acc);
    }
  }
  for (const [id, acc] of Array.from(onSite.entries())) roster.get(id)!.avgOnSiteMinutes = Math.round(acc.sum / acc.n);

  for (const [id, fix] of Array.from(fixes.entries())) {
    const row = roster.get(id);
    if (!row) continue;
    row.issuesFixedByQA = fix.count;
    row.rectificationMinutes = fix.minutes;
    row.rectificationCost = fix.cost;
  }

  for (const review of passedReviews) {
    const row = review.reviewedById ? roster.get(review.reviewedById) : undefined;
    if (!row) continue;
    row.caution.passedJobs += 1;
    const feedback = review.job?.feedback?.rating;
    const satisfaction = review.job?.satisfactionRating?.score;
    if ((typeof feedback === "number" && feedback <= 2) || (typeof satisfaction === "number" && satisfaction <= 2)) {
      row.caution.complaints += 1;
    }
  }
  for (const row of Array.from(roster.values())) {
    const { passedJobs, complaints } = row.caution;
    row.caution.complaintRate = passedJobs > 0 ? Math.round((complaints / passedJobs) * 1000) / 10 : null;
  }

  const rows = sortInspectorRows(Array.from(roster.values()), sort, dir);
  return { rows, issueTotal: rows.reduce((sum, row) => sum + row.issuesFound.total, 0), note: INSPECTOR_SCORING_NOTE };
}
