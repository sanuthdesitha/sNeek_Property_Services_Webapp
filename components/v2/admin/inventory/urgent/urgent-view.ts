/**
 * The Urgent needs view lives in the URL beside `tab=urgent-stock` (stage
 * chip, search, property, sort, page, open need), so old `/urgent-stock?
 * propertyId=…` links land pre-filtered and a reload shows the same list.
 * Pure: shared by the server page and the client hook.
 */
import { URGENT_FILTERS, URGENT_SORTS, type UrgentFilter, type UrgentSort } from "@/lib/inventory/urgent-stock-actions";

export type UrgentView = {
  filter: UrgentFilter;
  q: string;
  propertyId: string;
  sort: UrgentSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_URGENT_VIEW: UrgentView = { filter: "open", q: "", propertyId: "", sort: "neededBy", dir: "asc", page: 1, open: null };
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function readUrgentView(search: string): UrgentView {
  const params = new URLSearchParams(search);
  const filter = params.get("stage");
  const sort = params.get("sort");
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  const propertyId = params.get("propertyId") ?? "";
  return {
    filter: filter && (URGENT_FILTERS as readonly string[]).includes(filter) ? (filter as UrgentFilter) : DEFAULT_URGENT_VIEW.filter,
    q: params.get("q") ?? "",
    propertyId: ID_PATTERN.test(propertyId) ? propertyId : "",
    sort: sort && (URGENT_SORTS as readonly string[]).includes(sort) ? (sort as UrgentSort) : DEFAULT_URGENT_VIEW.sort,
    dir: params.get("dir") === "desc" ? "desc" : params.get("dir") === "asc" ? "asc" : DEFAULT_URGENT_VIEW.dir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

export function urgentListQuery(view: UrgentView, pageSize: number): string {
  const params = new URLSearchParams({ paginated: "1", stage: view.filter, sort: view.sort, dir: view.dir, page: String(view.page), pageSize: String(pageSize) });
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.propertyId) params.set("propertyId", view.propertyId);
  return params.toString();
}

/** The page URL's query: always `tab=urgent-stock`, then whatever differs from the default. */
export function urgentViewSearch(view: UrgentView): string {
  const params = new URLSearchParams({ tab: "urgent-stock" });
  if (view.filter !== DEFAULT_URGENT_VIEW.filter) params.set("stage", view.filter);
  if (view.q) params.set("q", view.q);
  if (view.propertyId) params.set("propertyId", view.propertyId);
  if (view.sort !== DEFAULT_URGENT_VIEW.sort || view.dir !== DEFAULT_URGENT_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  return `?${params.toString()}`;
}

export const URGENT_PAGE_RESETTING_KEYS: Array<keyof UrgentView> = ["filter", "q", "propertyId", "sort", "dir"];
