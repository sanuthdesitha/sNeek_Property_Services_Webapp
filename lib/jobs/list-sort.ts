/**
 * Jobs list ordering.
 *
 * Column sorts (When, Property, Client, Type, Status) plus "created" are read
 * through `parseListQuery`, so an unknown sort is refused with 400 on the
 * paginated list. The legacy values "soonest" and "latest" stay accepted as
 * aliases of When ascending / descending: the classic jobs page and saved
 * views still send them.
 *
 * Cleaner, Guest in and Charge are deliberately NOT sortable: a job can have
 * several cleaners, the arriving guest lives inside the notes JSON and the
 * charge is computed from rate tables, so none of them is a database column
 * the server can order honestly.
 */
import { parseListQuery, type SortDirection } from "@/lib/admin/list-query";

export const JOBS_SORTABLE = ["when", "property", "client", "type", "status", "created", "soonest", "latest"] as const;
export type JobsSortKey = (typeof JOBS_SORTABLE)[number];

/** Column sort keys the Jobs table header offers. */
export const JOBS_COLUMN_SORTS = ["when", "property", "client", "type", "status"] as const;
export type JobsColumnSort = (typeof JOBS_COLUMN_SORTS)[number];

export type JobsOrder = { key: Exclude<JobsSortKey, "soonest" | "latest">; dir: SortDirection };

/** Strict read for the paginated list: unknown sort or dir throws ListQueryError. */
export function readJobsOrder(searchParams: URLSearchParams): JobsOrder | null {
  const rawSort = searchParams.get("sort");
  if (rawSort === null || rawSort.trim() === "") return null;
  const rawDir = searchParams.get("dir");
  const legacyDir: SortDirection | undefined = rawSort === "latest" || rawSort === "created" ? "desc" : undefined;
  const query = parseListQuery(
    { sort: rawSort, ...(rawDir ? { dir: rawDir } : {}) },
    { sortable: JOBS_SORTABLE, defaultSort: "when", defaultDir: legacyDir ?? "asc" },
  );
  if (query.sort === "soonest") return { key: "when", dir: rawDir ? query.dir : "asc" };
  if (query.sort === "latest") return { key: "when", dir: rawDir ? query.dir : "desc" };
  return { key: query.sort, dir: query.dir };
}

/** Lenient read for the legacy non-paginated list: unknown values fall back. */
export function readLegacyJobsOrder(searchParams: URLSearchParams): JobsOrder | null {
  try {
    return readJobsOrder(searchParams);
  } catch {
    return null;
  }
}

function whenOrder(dir: SortDirection) {
  return [
    { scheduledDate: dir },
    { priorityBucket: "asc" as const },
    { dueTime: dir },
    { startTime: dir },
  ];
}

/**
 * Prisma orderBy for an order. With no explicit order the legacy
 * statusGroup-aware default applies so older callers keep their ordering.
 * Every order ends on `id` so paging is stable across equal values.
 */
export function buildJobsOrderBy(order: JobsOrder | null, statusGroup: string | null) {
  if (!order) return whenOrder(statusGroup === "completed" ? "desc" : "asc");
  switch (order.key) {
    case "when":
      return whenOrder(order.dir);
    case "created":
      return [{ createdAt: order.dir }, { id: "asc" as const }];
    case "property":
      return [{ property: { name: order.dir } }, { scheduledDate: "asc" as const }, { id: "asc" as const }];
    case "client":
      return [{ property: { client: { name: order.dir } } }, { scheduledDate: "asc" as const }, { id: "asc" as const }];
    case "type":
      return [{ jobType: order.dir }, { scheduledDate: "asc" as const }, { id: "asc" as const }];
    case "status":
      return [{ status: order.dir }, { scheduledDate: "asc" as const }, { id: "asc" as const }];
  }
}
