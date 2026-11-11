/**
 * Built-in Jobs views: the tabs above the Jobs table.
 *
 * Each view is defined ONCE, here, as a filter preset over the ordinary Jobs
 * filter fields. Choosing a tab applies exactly these filters (display
 * preferences such as sort, density and columns are left alone); the tab's
 * count comes from the grouped server query in `view-counts.ts`, which reads
 * the same declarations, so a tab's number and the rows it shows answer the
 * same question.
 *
 * "Not invoiced" uses the existing Invoice filter ("no": not INVOICED and no
 * invoice line) restricted to Completed jobs. The existing filter counts a line
 * on a voided invoice as invoiced; that rule is kept, not reinterpreted here.
 */
import type { JobStatus } from "@prisma/client";
import { DEFAULT_JOBS_STATE, type JobsWorkspaceState } from "./workspace-state";

export const JOBS_FILTER_KEYS = [
  "dateScope", "statusChip", "search", "jobType", "clientId", "propertyId",
  "cleanerId", "dateFrom", "dateTo", "invoiced",
] as const;
export type JobsFilterKey = (typeof JOBS_FILTER_KEYS)[number];
export type JobsFilters = Pick<JobsWorkspaceState, JobsFilterKey>;

export type BuiltInViewId = "today" | "needs-cleaner" | "week" | "awaiting-qa" | "not-invoiced" | "all";

/** The declarative part a count query can evaluate. */
export type BuiltInViewRule = {
  dateScope?: "today" | "week";
  statuses?: JobStatus[];
  invoiced?: "no";
};

export type BuiltInView = {
  id: BuiltInViewId;
  label: string;
  rule: BuiltInViewRule;
};

export const BUILT_IN_VIEWS: readonly BuiltInView[] = [
  { id: "today", label: "Today", rule: { dateScope: "today" } },
  { id: "needs-cleaner", label: "Needs a cleaner", rule: { statuses: ["UNASSIGNED", "OFFERED"] } },
  { id: "week", label: "This week", rule: { dateScope: "week" } },
  { id: "awaiting-qa", label: "Awaiting QA", rule: { statuses: ["SUBMITTED", "QA_REVIEW"] } },
  { id: "not-invoiced", label: "Not invoiced", rule: { statuses: ["COMPLETED"], invoiced: "no" } },
  { id: "all", label: "All", rule: {} },
];

export function defaultJobsFilters(): JobsFilters {
  const filters = {} as Record<JobsFilterKey, string>;
  for (const key of JOBS_FILTER_KEYS) filters[key] = DEFAULT_JOBS_STATE[key];
  return filters as JobsFilters;
}

/** The complete filter set a built-in view applies (every other filter cleared). */
export function builtInViewFilters(id: BuiltInViewId): JobsFilters {
  const view = BUILT_IN_VIEWS.find((item) => item.id === id);
  const filters = defaultJobsFilters();
  if (!view) return filters;
  if (view.rule.dateScope) filters.dateScope = view.rule.dateScope;
  if (view.rule.statuses) filters.statusChip = view.rule.statuses.join(",");
  if (view.rule.invoiced) filters.invoiced = view.rule.invoiced;
  return filters;
}

export function pickJobsFilters(state: JobsWorkspaceState): JobsFilters {
  const filters = {} as Record<JobsFilterKey, string>;
  for (const key of JOBS_FILTER_KEYS) filters[key] = state[key];
  return filters as JobsFilters;
}

/** The built-in view whose filters equal the current filters exactly, if any. */
export function activeBuiltInView(state: JobsWorkspaceState): BuiltInViewId | null {
  const current = pickJobsFilters(state);
  const match = BUILT_IN_VIEWS.find((view) => {
    const preset = builtInViewFilters(view.id);
    return JOBS_FILTER_KEYS.every((key) => preset[key] === current[key]);
  });
  return match?.id ?? null;
}

export type JobsViewCounts = Record<BuiltInViewId, number>;
