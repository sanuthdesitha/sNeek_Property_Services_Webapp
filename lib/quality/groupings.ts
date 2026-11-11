/**
 * The three groupings of one filtered issue set: by cleaner, by inspector and
 * by category, plus the totals the stat cards show. Pure, so a test can prove
 * that the groupings agree with each other and with the totals.
 *
 * Definitions are the ones the accountability overview and QA performance
 * routes used: open fix = OPEN_RECTIFICATION_STATUSES; a false-confirmation
 * flag raised = SUSPECTED or CONFIRMED; "fixed by QA" = FIXED_BY_QA with a
 * recorded rectifier, credited to that rectifier.
 */
import {
  ISSUE_SEVERITIES,
  isOpenRectification,
  type IssueSeverity,
} from "./types";

export type IssueFact = {
  id: string;
  cleanerId: string;
  cleanerName: string;
  raisedById: string;
  raisedByName: string;
  raisedByRole: string;
  category: string;
  severity: string;
  rectificationStatus: string;
  falseConfirmation: string;
  rectifiedById: string | null;
  rectificationMinutes: number | null;
  rectificationCost: number | null;
  createdAt: Date;
};

export type SeverityCounts = Record<IssueSeverity, number>;
export type CategoryCount = { category: string; label: string; count: number };

export type CleanerIssueSummary = {
  cleanerId: string;
  cleanerName: string;
  total: number;
  bySeverity: SeverityCounts;
  categories: CategoryCount[];
  openFixes: number;
  falseConfirmations: { suspected: number; confirmed: number };
};

export type InspectorIssueSummary = {
  inspectorId: string;
  name: string;
  role: string;
  found: SeverityCounts & { total: number };
  flagsRaised: number;
};

export type QaFixSummary = { count: number; minutes: number; cost: number };

export type CategorySummary = {
  category: string;
  label: string;
  total: number;
  bySeverity: SeverityCounts;
  openFixes: number;
  cleaners: Array<{ cleanerId: string; name: string; count: number }>;
};

export type IssueTotals = {
  total: number;
  bySeverity: SeverityCounts;
  openFixes: number;
  openOver48h: number;
  /** Sum of recorded rectification cost; null when no issue has one. */
  fixCost: number | null;
  /** Sum of recorded rectification minutes; null when no issue has any. */
  fixMinutes: number | null;
  fixesWithCost: number;
  fixesWithMinutes: number;
};

export type LabelFor = (category: string) => string;

const OPEN_AGE_MS = 48 * 3_600_000;

export function emptySeverityCounts(): SeverityCounts {
  return { MINOR: 0, MAJOR: 0, CRITICAL: 0 };
}

function countSeverity(counts: SeverityCounts, severity: string) {
  if ((ISSUE_SEVERITIES as readonly string[]).includes(severity)) counts[severity as IssueSeverity] += 1;
}

function sortedCategories(counts: Map<string, number>, labelFor: LabelFor): CategoryCount[] {
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, label: labelFor(category), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function issueTotals(issues: readonly IssueFact[], now: Date): IssueTotals {
  const totals: IssueTotals = {
    total: issues.length,
    bySeverity: emptySeverityCounts(),
    openFixes: 0,
    openOver48h: 0,
    fixCost: null,
    fixMinutes: null,
    fixesWithCost: 0,
    fixesWithMinutes: 0,
  };
  let cost = 0;
  let minutes = 0;
  for (const issue of issues) {
    countSeverity(totals.bySeverity, issue.severity);
    if (isOpenRectification(issue.rectificationStatus)) {
      totals.openFixes += 1;
      if (now.getTime() - issue.createdAt.getTime() > OPEN_AGE_MS) totals.openOver48h += 1;
    }
    if (typeof issue.rectificationCost === "number") {
      cost += issue.rectificationCost;
      totals.fixesWithCost += 1;
    }
    if (typeof issue.rectificationMinutes === "number") {
      minutes += issue.rectificationMinutes;
      totals.fixesWithMinutes += 1;
    }
  }
  totals.fixCost = totals.fixesWithCost > 0 ? roundMoney(cost) : null;
  totals.fixMinutes = totals.fixesWithMinutes > 0 ? minutes : null;
  return totals;
}

export function groupIssuesByCleaner(issues: readonly IssueFact[], labelFor: LabelFor): Map<string, CleanerIssueSummary> {
  const rows = new Map<string, CleanerIssueSummary & { categoryCounts: Map<string, number> }>();
  for (const issue of issues) {
    let row = rows.get(issue.cleanerId);
    if (!row) {
      row = {
        cleanerId: issue.cleanerId,
        cleanerName: issue.cleanerName,
        total: 0,
        bySeverity: emptySeverityCounts(),
        categories: [],
        categoryCounts: new Map(),
        openFixes: 0,
        falseConfirmations: { suspected: 0, confirmed: 0 },
      };
      rows.set(issue.cleanerId, row);
    }
    row.total += 1;
    countSeverity(row.bySeverity, issue.severity);
    row.categoryCounts.set(issue.category, (row.categoryCounts.get(issue.category) ?? 0) + 1);
    if (isOpenRectification(issue.rectificationStatus)) row.openFixes += 1;
    if (issue.falseConfirmation === "SUSPECTED") row.falseConfirmations.suspected += 1;
    if (issue.falseConfirmation === "CONFIRMED") row.falseConfirmations.confirmed += 1;
  }
  const out = new Map<string, CleanerIssueSummary>();
  for (const [id, { categoryCounts, ...row }] of Array.from(rows.entries())) {
    out.set(id, { ...row, categories: sortedCategories(categoryCounts, labelFor) });
  }
  return out;
}

export function groupIssuesByInspector(issues: readonly IssueFact[]): Map<string, InspectorIssueSummary> {
  const rows = new Map<string, InspectorIssueSummary>();
  for (const issue of issues) {
    let row = rows.get(issue.raisedById);
    if (!row) {
      row = {
        inspectorId: issue.raisedById,
        name: issue.raisedByName,
        role: issue.raisedByRole,
        found: { ...emptySeverityCounts(), total: 0 },
        flagsRaised: 0,
      };
      rows.set(issue.raisedById, row);
    }
    countSeverity(row.found, issue.severity);
    row.found.total += 1;
    if (issue.falseConfirmation === "SUSPECTED" || issue.falseConfirmation === "CONFIRMED") row.flagsRaised += 1;
  }
  return rows;
}

/** Issues QA fixed themselves, credited to the recorded rectifier. */
export function groupQaFixesByRectifier(issues: readonly IssueFact[]): Map<string, QaFixSummary> {
  const rows = new Map<string, QaFixSummary>();
  for (const issue of issues) {
    if (issue.rectificationStatus !== "FIXED_BY_QA" || !issue.rectifiedById) continue;
    const row = rows.get(issue.rectifiedById) ?? { count: 0, minutes: 0, cost: 0 };
    row.count += 1;
    row.minutes += issue.rectificationMinutes ?? 0;
    row.cost = roundMoney(row.cost + (issue.rectificationCost ?? 0));
    rows.set(issue.rectifiedById, row);
  }
  return rows;
}

export function groupIssuesByCategory(issues: readonly IssueFact[], labelFor: LabelFor): CategorySummary[] {
  const rows = new Map<string, CategorySummary & { cleanerCounts: Map<string, { name: string; count: number }> }>();
  for (const issue of issues) {
    let row = rows.get(issue.category);
    if (!row) {
      row = {
        category: issue.category,
        label: labelFor(issue.category),
        total: 0,
        bySeverity: emptySeverityCounts(),
        openFixes: 0,
        cleaners: [],
        cleanerCounts: new Map(),
      };
      rows.set(issue.category, row);
    }
    row.total += 1;
    countSeverity(row.bySeverity, issue.severity);
    if (isOpenRectification(issue.rectificationStatus)) row.openFixes += 1;
    const cleaner = row.cleanerCounts.get(issue.cleanerId) ?? { name: issue.cleanerName, count: 0 };
    cleaner.count += 1;
    row.cleanerCounts.set(issue.cleanerId, cleaner);
  }
  return Array.from(rows.values()).map(({ cleanerCounts, ...row }) => ({
    ...row,
    cleaners: Array.from(cleanerCounts.entries())
      .map(([cleanerId, value]) => ({ cleanerId, name: value.name, count: value.count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }));
}
