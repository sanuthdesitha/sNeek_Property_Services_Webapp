/**
 * Stat cards and tab counts for the Quality hub header.
 *
 * Every figure carries its own sample, so the screen can say "not enough
 * data" instead of printing a zero, and the score change is only stated when
 * the previous period has reviewed cleans.
 */
import { QaAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { quickScoreCandidateWhere } from "@/lib/qa/auto-score";
import { cleanTotals } from "./cleans";
import { loadCategoryLabels, loadCleanFacts, loadIssueFacts } from "./facts";
import { issueTotals } from "./groupings";
import { deltaVsPrevious, type QualityPeriod } from "./period";
import { OPEN_COACHING_STATUSES, type QualityFilters } from "./types";
import { queueJobNarrow } from "./where";

export const OPEN_INSPECTION_STATUSES: QaAssignmentStatus[] = [
  QaAssignmentStatus.OPEN,
  QaAssignmentStatus.ASSIGNED,
  QaAssignmentStatus.IN_PROGRESS,
];

export type QualitySummary = {
  cleansReviewed: { reviewed: number; cleans: number };
  averageScore: {
    value: number | null;
    /** Reviewed cleans behind `value`. */
    sample: number;
    previous: number | null;
    previousSample: number;
    /** null unless both periods have reviewed cleans. */
    delta: number | null;
  };
  issuesRaised: { total: number; critical: number; major: number; minor: number };
  fixesOpen: { open: number; over48h: number };
  fixCost: { amount: number | null; minutes: number | null; fixesWithCost: number };
  tabs: { reviewQueue: number; inspections: number; quickScore: number; issues: number; coaching: number };
};

export async function getQualitySummary(
  period: QualityPeriod,
  filters: QualityFilters,
  now: Date = new Date(),
): Promise<QualitySummary> {
  const labels = await loadCategoryLabels();
  const narrow = queueJobNarrow(filters);
  const [issues, cleans, previousCleans, inspections, quickScore, coaching] = await Promise.all([
    loadIssueFacts(period, filters, labels),
    loadCleanFacts(period, filters),
    period.previous ? loadCleanFacts(period.previous, filters) : Promise.resolve([]),
    db.qaAssignment.count({
      where: { status: { in: OPEN_INSPECTION_STATUSES }, ...(narrow ? { job: narrow } : {}) },
    }),
    db.job.count({ where: quickScoreCandidateWhere(narrow) }),
    db.coachingRecord.count({
      where: {
        status: { in: [...OPEN_COACHING_STATUSES] },
        ...(filters.cleanerId ? { cleanerId: filters.cleanerId } : {}),
      },
    }),
  ]);

  const totals = issueTotals(issues, now);
  const current = cleanTotals(cleans, period);
  const previous = period.previous ? cleanTotals(previousCleans, period.previous) : null;

  return {
    cleansReviewed: { reviewed: current.reviewed, cleans: current.cleans },
    averageScore: {
      value: current.avgScore,
      sample: current.reviewed,
      previous: previous?.avgScore ?? null,
      previousSample: previous?.reviewed ?? 0,
      delta: deltaVsPrevious(current.avgScore, previous?.avgScore ?? null, previous?.reviewed ?? 0),
    },
    issuesRaised: {
      total: totals.total,
      critical: totals.bySeverity.CRITICAL,
      major: totals.bySeverity.MAJOR,
      minor: totals.bySeverity.MINOR,
    },
    fixesOpen: { open: totals.openFixes, over48h: totals.openOver48h },
    fixCost: { amount: totals.fixCost, minutes: totals.fixMinutes, fixesWithCost: totals.fixesWithCost },
    tabs: {
      reviewQueue: inspections + quickScore,
      inspections,
      quickScore,
      issues: totals.total,
      coaching,
    },
  };
}
