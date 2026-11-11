/**
 * Jobs page ⇄ `/api/jobs` contract: the query the page sends for its state,
 * the sort mapping between the URL value and the column headers, and the
 * validated row shape it reads back.
 */
import { z } from "zod";
import { jobsDateScopeRange } from "@/lib/jobs/date-scope";
import { jobGuestInSchema, jobListChargeSchema } from "@/lib/jobs/peek-types";
import { BUILT_IN_VIEWS, type BuiltInViewId } from "@/lib/jobs/view-presets";
import { JOBS_COLUMN_SORTS, type JobsColumnSort } from "@/lib/jobs/list-sort";
import type { JobsWorkspaceState } from "@/lib/jobs/workspace-state";

export const JOBS_PAGE_SIZE = 50;

export type SortDirection = "asc" | "desc";
export type JobsTableSort = { key: JobsColumnSort; dir: SortDirection };

/** URL sort value → header sort. "created" has no column, so no header is active. */
export function tableSortFromState(sort: string): JobsTableSort | null {
  if (sort === "soonest") return { key: "when", dir: "asc" };
  if (sort === "latest") return { key: "when", dir: "desc" };
  const [key, suffix] = sort.split("_");
  const column = (JOBS_COLUMN_SORTS as readonly string[]).includes(key) && key !== "when" ? (key as JobsColumnSort) : null;
  if (column) return { key: column, dir: suffix === "desc" ? "desc" : "asc" };
  return null;
}

/** Header sort → URL sort value (When keeps the legacy soonest/latest names). */
export function stateSortFromTable(sort: JobsTableSort): string {
  if (sort.key === "when") return sort.dir === "asc" ? "soonest" : "latest";
  return sort.dir === "asc" ? sort.key : `${sort.key}_desc`;
}

/** URL sort value → the API's `sort` and `dir` (list-query contract). */
export function apiSortParams(sort: string): { sort: string; dir: SortDirection } {
  if (sort === "created") return { sort: "created", dir: "desc" };
  const table = tableSortFromState(sort) ?? { key: "when", dir: "asc" };
  return { sort: table.key, dir: table.dir };
}

/** The list query for a state (page and limit added by the caller). */
export function buildJobsQuery(state: JobsWorkspaceState, overrides?: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams({ paginated: "1" });
  if (state.statusChip === "active") params.set("statusGroup", "active");
  else if (state.statusChip !== "all") params.set("status", state.statusChip);
  const sort = apiSortParams(state.sort);
  params.set("sort", sort.sort);
  params.set("dir", sort.dir);
  if (state.jobType !== "all") params.set("jobType", state.jobType);
  if (state.clientId !== "all") params.set("clientId", state.clientId);
  if (state.propertyId !== "all") params.set("propertyId", state.propertyId);
  if (state.cleanerId !== "all") params.set("cleanerId", state.cleanerId);
  if (state.search.trim()) params.set("search", state.search.trim());
  if (state.invoiced !== "all") params.set("invoiced", state.invoiced);
  // An explicit from/to range overrides the date shortcut.
  if (state.dateFrom || state.dateTo) {
    if (state.dateFrom) params.set("dateFrom", state.dateFrom);
    if (state.dateTo) params.set("dateTo", state.dateTo);
  } else {
    const range = jobsDateScopeRange(state.dateScope);
    if (range.dateFrom) params.set("dateFrom", range.dateFrom);
    if (range.dateTo) params.set("dateTo", range.dateTo);
  }
  if (overrides) for (const [key, value] of Object.entries(overrides)) params.set(key, value);
  return params;
}

const nullableText = z.string().nullish();

export const jobListRowSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  jobNumber: z.union([z.string(), z.number()]).nullish(),
  jobType: nullableText,
  scheduledDate: z.string().refine((value) => Number.isFinite(Date.parse(value))).nullish(),
  startTime: nullableText,
  endTime: nullableText,
  dueTime: nullableText,
  cleanSkipStatus: nullableText,
  isRework: z.boolean().nullish(),
  property: z.object({
    name: nullableText,
    suburb: nullableText,
    client: z.object({ id: nullableText, name: nullableText }).passthrough().nullish(),
  }).passthrough().nullish(),
  assignments: z.array(z.object({
    user: z.object({ id: nullableText, name: nullableText, email: nullableText }).passthrough().nullish(),
  }).passthrough()).optional(),
  timingBadges: z.object({ early: nullableText, late: nullableText }).passthrough().nullish(),
  payAdjustments: z.array(z.unknown()).optional(),
  issueTickets: z.array(z.unknown()).optional(),
  guestIn: jobGuestInSchema.optional(),
  charge: jobListChargeSchema.optional(),
}).passthrough();
export type JobListRow = z.infer<typeof jobListRowSchema>;

const countsShape = Object.fromEntries(BUILT_IN_VIEWS.map((view) => [view.id, z.number().int().nonnegative()])) as Record<BuiltInViewId, z.ZodNumber>;

export const jobsResponseSchema = z.object({
  jobs: z.array(jobListRowSchema),
  pagination: z.object({
    page: z.number().int().positive().safe(),
    limit: z.number().int().positive().safe(),
    totalCount: z.number().int().nonnegative().safe(),
    totalPages: z.number().int().positive().safe(),
    hasMore: z.boolean(),
  }),
  counts: z.object(countsShape).optional(),
});
export type JobsResponse = z.infer<typeof jobsResponseSchema>;
export type JobsPagination = JobsResponse["pagination"];

/** Rejects a page whose arithmetic does not add up rather than showing it. */
export function validPage(data: JobsResponse, requestedPage: number): boolean {
  const page = data.pagination;
  return page.page === requestedPage && page.limit === JOBS_PAGE_SIZE && data.jobs.length <= JOBS_PAGE_SIZE
    && page.totalPages === Math.max(1, Math.ceil(page.totalCount / page.limit))
    && page.hasMore === (page.page < page.totalPages);
}

/**
 * A 400 from a computed sort (Guest in, Charge) over too many jobs carries the
 * server's own sentence asking to narrow the filters; show it as written.
 */
export function jobsSortRefusal(status: number, body: unknown): string | null {
  if (status !== 400 || !body || typeof body !== "object") return null;
  const record = body as { code?: unknown; error?: unknown };
  return record.code === "SORT_SET_TOO_LARGE" && typeof record.error === "string" ? record.error : null;
}

export function jobsLoadFailureMessage(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again to load jobs.";
  if (status === 403) return "This account does not have permission to view jobs.";
  if (status === 503) return "Jobs are temporarily unavailable. Please retry shortly. (503)";
  return `The server could not load jobs. Please retry. (${status})`;
}
