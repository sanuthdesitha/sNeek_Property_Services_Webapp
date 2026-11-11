/**
 * Cleaners tab: one row per cleaner over the hub's period and filters.
 *
 * Issue columns come from the shared filtered issue set (groupIssuesByCleaner),
 * so the column totals equal the Issues tab total. Clean columns use the
 * clean basis in ./cleans. Streak and last-5/last-10 come from the shared
 * accountability streak rule (./streaks). Sorting is done here, server-side,
 * against an allow-list; null figures always sort last.
 */
import { cleanTotalsByCleaner, trendStartKey, weeklyTrend, type TrendPoint } from "./cleans";
import { cleanerAction, loadCleanerSignals, type BonusProposal, type CleanerAction, type CoachingSuggestion } from "./cleaner-signals";
import { labelLookup, loadActiveCleaners, loadCategoryLabels, loadCleanFacts, loadIssueFacts } from "./facts";
import { narrowsIssues } from "./filters";
import { groupIssuesByCleaner, type CategoryCount, type SeverityCounts } from "./groupings";
import { rangeFromKeys, type QualityPeriod } from "./period";
import { loadCleanerStreaks, type CleanerStreak } from "./streaks";
import type { CleanerSort, QualityFilters } from "./types";

export type CleanerRow = {
  cleanerId: string;
  name: string;
  /** False for someone outside the active cleaner roster who has issues in the period. */
  active: boolean;
  cleans: number;
  reviewed: number;
  avgScore: number | null;
  trend: TrendPoint[];
  issues: { total: number; bySeverity: SeverityCounts };
  topCategory: CategoryCount | null;
  categories: CategoryCount[];
  openFixes: number;
  falseConfirmations: { suspected: number; confirmed: number };
  streak: CleanerStreak | null;
  pendingBonuses: BonusProposal[];
  openCoaching: number;
  coachingSuggestion: CoachingSuggestion | null;
  action: CleanerAction;
};

export type CleanerRowsResult = {
  rows: CleanerRow[];
  /** Sum of issue counts over the rows: equals the Issues tab total for the same filters. */
  issueTotal: number;
  sort: CleanerSort;
  dir: "asc" | "desc";
};

type SortValue = string | number | null;

function sortValue(row: CleanerRow, sort: CleanerSort): SortValue {
  switch (sort) {
    case "cleaner":
      return row.name.toLowerCase();
    case "cleans":
      return row.cleans;
    case "score":
      return row.avgScore;
    case "issues":
      return row.issues.total;
    case "topCategory":
      return row.topCategory?.label.toLowerCase() ?? null;
    case "openFixes":
      return row.openFixes;
    case "falseConfirmations":
      return row.falseConfirmations.suspected + row.falseConfirmations.confirmed;
    case "streak":
      return row.streak && row.streak.sample > 0 ? row.streak.currentStreak : null;
  }
}

export function sortCleanerRows(rows: CleanerRow[], sort: CleanerSort, dir: "asc" | "desc"): CleanerRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left < right) return -1 * factor;
    if (left > right) return 1 * factor;
    return a.name.localeCompare(b.name);
  });
}

export async function getCleanerRows(
  period: QualityPeriod,
  filters: QualityFilters,
  sort: CleanerSort,
  dir: "asc" | "desc",
  now: Date = new Date(),
): Promise<CleanerRowsResult> {
  const labels = await loadCategoryLabels();
  const labelFor = labelLookup(labels);
  // One clean read covers the period and the 8-week trend window.
  const trendFrom = trendStartKey(period.toKey);
  const cleanFrom = period.fromKey && period.fromKey < trendFrom ? period.fromKey : trendFrom;
  const [issues, cleans, roster] = await Promise.all([
    loadIssueFacts(period, filters, labels),
    loadCleanFacts(rangeFromKeys(period.fromKey === null ? null : cleanFrom, period.toKey), filters),
    loadActiveCleaners(),
  ]);

  const byCleaner = groupIssuesByCleaner(issues, labelFor);
  const cleanStats = cleanTotalsByCleaner(cleans, period);
  const people = new Map(roster.map((person) => [person.id, { name: person.name, active: true }]));
  for (const summary of Array.from(byCleaner.values())) {
    if (!people.has(summary.cleanerId)) people.set(summary.cleanerId, { name: summary.cleanerName, active: false });
  }

  const needle = filters.q.trim().toLowerCase();
  const issueNarrowed = narrowsIssues(filters);
  const visibleIds = Array.from(people.keys()).filter((id) => {
    const person = people.get(id)!;
    const hasIssues = byCleaner.has(id);
    const hasCleans = (cleanStats.get(id)?.cleans ?? 0) > 0;
    if (filters.cleanerId && id !== filters.cleanerId) return false;
    if (issueNarrowed) return hasIssues;
    if (filters.propertyId) return hasIssues || hasCleans;
    if (needle) return person.name.toLowerCase().includes(needle) || hasIssues || hasCleans;
    return true;
  });

  const [streaks, signals] = await Promise.all([
    loadCleanerStreaks(visibleIds),
    loadCleanerSignals(visibleIds, labelFor, now),
  ]);

  const rows: CleanerRow[] = visibleIds.map((id) => {
    const person = people.get(id)!;
    const summary = byCleaner.get(id);
    const clean = cleanStats.get(id) ?? { cleans: 0, reviewed: 0, avgScore: null };
    const suggestion = signals.suggestions.get(id) ?? null;
    const openCoaching = signals.openCoaching.get(id) ?? 0;
    const pendingBonuses = signals.bonuses.get(id) ?? [];
    return {
      cleanerId: id,
      name: person.name,
      active: person.active,
      cleans: clean.cleans,
      reviewed: clean.reviewed,
      avgScore: clean.avgScore,
      trend: weeklyTrend(cleans, period.toKey, id),
      issues: { total: summary?.total ?? 0, bySeverity: summary?.bySeverity ?? { MINOR: 0, MAJOR: 0, CRITICAL: 0 } },
      topCategory: summary?.categories[0] ?? null,
      categories: summary?.categories ?? [],
      openFixes: summary?.openFixes ?? 0,
      falseConfirmations: summary?.falseConfirmations ?? { suspected: 0, confirmed: 0 },
      streak: streaks.get(id) ?? null,
      pendingBonuses,
      openCoaching,
      coachingSuggestion: suggestion,
      action: cleanerAction({ suggestion, openCoaching, bonuses: pendingBonuses.length }),
    };
  });

  return {
    rows: sortCleanerRows(rows, sort, dir),
    issueTotal: rows.reduce((sum, row) => sum + row.issues.total, 0),
    sort,
    dir,
  };
}
