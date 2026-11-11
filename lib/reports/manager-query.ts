/**
 * URL state of the Client report PDFs manager (the last Insights tab), and the
 * rule that sends an old `/v2/admin/reports?…` link to that tab.
 *
 * Manager parameters: q, propertyId, visibility, sort, page. They are the
 * filters the manager has always sent to GET /api/admin/reports.
 *
 * Legacy rule: without an explicit `tab`, a link carrying q, propertyId or
 * visibility, or a sort the manager understands (newest / service-date /
 * oldest), opens the PDFs tab with those filters. `page` alone does not, since
 * every paged tab uses it. An explicit `tab` always wins.
 *
 * Pure.
 */
export const REPORT_SORTS = ["newest", "service-date", "oldest"] as const;
export type ReportSort = (typeof REPORT_SORTS)[number];

export const REPORT_VISIBILITY_FILTERS = ["all", "client-visible", "client-hidden"] as const;
export type ReportVisibilityFilter = (typeof REPORT_VISIBILITY_FILTERS)[number];

export type ReportManagerFilters = {
  q: string;
  propertyId: string;
  visibility: ReportVisibilityFilter;
  sort: ReportSort;
  page: number;
};

export const DEFAULT_REPORT_FILTERS: ReportManagerFilters = {
  q: "",
  propertyId: "all",
  visibility: "all",
  sort: "newest",
  page: 1,
};

const PROPERTY_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function readReportFilters(params: URLSearchParams): ReportManagerFilters {
  const visibility = params.get("visibility") ?? "";
  const sort = params.get("sort") ?? "";
  const propertyId = params.get("propertyId") ?? "";
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").slice(0, 200),
    propertyId: PROPERTY_ID.test(propertyId) ? propertyId : "all",
    visibility: (REPORT_VISIBILITY_FILTERS as readonly string[]).includes(visibility) ? (visibility as ReportVisibilityFilter) : "all",
    sort: (REPORT_SORTS as readonly string[]).includes(sort) ? (sort as ReportSort) : "newest",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Writes the manager's filters into `base`, leaving other params alone; defaults are omitted. */
export function writeReportFilters(base: URLSearchParams, filters: ReportManagerFilters): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  const entries: Array<[keyof ReportManagerFilters, string]> = [
    ["q", filters.q.trim()],
    ["propertyId", filters.propertyId === "all" ? "" : filters.propertyId],
    ["visibility", filters.visibility === "all" ? "" : filters.visibility],
    ["sort", filters.sort === "newest" ? "" : filters.sort],
    ["page", filters.page > 1 ? String(filters.page) : ""],
  ];
  for (const [key, value] of entries) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** True when an untabbed link carries the manager's own filters (see the legacy rule). */
export function hasLegacyReportParams(params: URLSearchParams): boolean {
  if (params.get("q") || params.get("propertyId") || params.get("visibility")) return true;
  const sort = params.get("sort");
  return sort !== null && (REPORT_SORTS as readonly string[]).includes(sort);
}
