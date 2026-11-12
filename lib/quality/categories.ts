/**
 * Categories tab: issues by category over the hub's period and filters, each
 * with its severity split, open fixes and the cleaners behind it. Replaces the
 * category × cleaner matrix, which grew a column per cleaner.
 */
import { labelLookup, loadCategoryLabels, loadIssueFacts } from "./facts";
import { groupIssuesByCategory, type CategorySummary } from "./groupings";
import type { PeriodRange } from "./period";
import type { CategorySort, QualityFilters } from "./types";

export type CategoryRowsResult = { rows: CategorySummary[]; issueTotal: number };

export function sortCategoryRows(rows: CategorySummary[], sort: CategorySort, dir: "asc" | "desc"): CategorySummary[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === "category") return a.label.localeCompare(b.label) * factor;
    const left = sort === "issues" ? a.total : a.openFixes;
    const right = sort === "issues" ? b.total : b.openFixes;
    if (left !== right) return (left - right) * factor;
    return a.label.localeCompare(b.label);
  });
}

export async function getCategoryRows(
  range: PeriodRange,
  filters: QualityFilters,
  sort: CategorySort = "issues",
  dir: "asc" | "desc" = "desc",
): Promise<CategoryRowsResult> {
  const labels = await loadCategoryLabels();
  const issues = await loadIssueFacts(range, filters, labels);
  const rows = sortCategoryRows(groupIssuesByCategory(issues, labelLookup(labels)), sort, dir);
  return { rows, issueTotal: rows.reduce((sum, row) => sum + row.total, 0) };
}
