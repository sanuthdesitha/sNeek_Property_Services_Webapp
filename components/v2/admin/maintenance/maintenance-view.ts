/**
 * The Maintenance page view lives in the URL (tab, status bar, filters, sort,
 * page and the open item), so a reload or a shared link shows the same list.
 * Pure: shared by the server page and the client hook (no "use client").
 *
 * Old links keep working: `/v2/admin/maintenance` with no query opens the
 * Items tab on every open item, as before.
 */
import {
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
} from "@prisma/client";
import {
  DEFAULT_MAINTENANCE_FILTERS,
  MAINTENANCE_LIST_SORTS,
  MAINTENANCE_PERIOD_FILTERS,
  MAINTENANCE_PRICE_FILTERS,
  MAINTENANCE_STATUS_TABS,
  MAINTENANCE_VISIBILITY_FILTERS,
  type MaintenanceListFilters,
  type MaintenanceListSort,
} from "@/lib/maintenance/admin-list-types";

export const MAINTENANCE_TABS = ["items", "people"] as const;
export type MaintenanceTab = (typeof MAINTENANCE_TABS)[number];

export type MaintenanceView = MaintenanceListFilters & {
  tab: MaintenanceTab;
  sort: MaintenanceListSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_MAINTENANCE_VIEW: MaintenanceView = {
  ...DEFAULT_MAINTENANCE_FILTERS,
  tab: "items",
  sort: "priority",
  dir: "desc",
  page: 1,
  open: null,
};

export const MAINTENANCE_PAGE_SIZE = 25;

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const ASSIGNED_PATTERN = /^(?:any|none|(?:worker|user):[a-zA-Z0-9_-]{1,128})$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function listOf<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (!value) return [];
  return Array.from(new Set(value.split(",").map((part) => part.trim()))).filter((part): part is T =>
    (allowed as readonly string[]).includes(part),
  );
}

/** Reads a view from a query string, dropping anything unknown (an old or edited link). */
export function readMaintenanceView(search: string): MaintenanceView {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  const propertyId = params.get("propertyId") ?? "";
  const assigned = params.get("assigned") ?? "any";
  const category = params.get("category") ?? "";
  return {
    tab: oneOf(params.get("tab"), MAINTENANCE_TABS, DEFAULT_MAINTENANCE_VIEW.tab),
    status: oneOf(params.get("status"), MAINTENANCE_STATUS_TABS, DEFAULT_MAINTENANCE_VIEW.status),
    q: (params.get("q") ?? "").slice(0, 120),
    propertyId: ID_PATTERN.test(propertyId) ? propertyId : "",
    priority: listOf(params.get("priority"), Object.values(MaintenancePriority)),
    category: (Object.values(MaintenanceCategory) as string[]).includes(category) ? (category as MaintenanceView["category"]) : "",
    source: listOf(params.get("source"), Object.values(MaintenanceSource)),
    assigned: ASSIGNED_PATTERN.test(assigned) ? assigned : "any",
    price: oneOf(params.get("price"), MAINTENANCE_PRICE_FILTERS, "any"),
    visible: oneOf(params.get("visible"), MAINTENANCE_VISIBILITY_FILTERS, "any"),
    period: oneOf(params.get("period"), MAINTENANCE_PERIOD_FILTERS, "any"),
    sort: oneOf(params.get("sort"), MAINTENANCE_LIST_SORTS, DEFAULT_MAINTENANCE_VIEW.sort),
    dir: params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : DEFAULT_MAINTENANCE_VIEW.dir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

/** Filter parameters shared by the list API and the CSV export (never the tab, page or open item). */
function filterParams(view: MaintenanceView): URLSearchParams {
  const params = new URLSearchParams({ status: view.status, sort: view.sort, dir: view.dir });
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.propertyId) params.set("propertyId", view.propertyId);
  if (view.priority.length > 0) params.set("priority", view.priority.join(","));
  if (view.category) params.set("category", view.category);
  if (view.source.length > 0) params.set("source", view.source.join(","));
  if (view.assigned !== "any") params.set("assigned", view.assigned);
  if (view.price !== "any") params.set("price", view.price);
  if (view.visible !== "any") params.set("visible", view.visible);
  if (view.period !== "any") params.set("period", view.period);
  return params;
}

export function listQueryString(view: MaintenanceView, pageSize: number): string {
  const params = filterParams(view);
  params.set("page", String(view.page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export function exportQueryString(view: MaintenanceView): string {
  return filterParams(view).toString();
}

/** The address bar form: only what differs from the default. */
export function viewSearch(view: MaintenanceView): string {
  const params = new URLSearchParams();
  if (view.tab !== DEFAULT_MAINTENANCE_VIEW.tab) params.set("tab", view.tab);
  if (view.status !== DEFAULT_MAINTENANCE_VIEW.status) params.set("status", view.status);
  if (view.q) params.set("q", view.q);
  if (view.propertyId) params.set("propertyId", view.propertyId);
  if (view.priority.length > 0) params.set("priority", view.priority.join(","));
  if (view.category) params.set("category", view.category);
  if (view.source.length > 0) params.set("source", view.source.join(","));
  if (view.assigned !== "any") params.set("assigned", view.assigned);
  if (view.price !== "any") params.set("price", view.price);
  if (view.visible !== "any") params.set("visible", view.visible);
  if (view.period !== "any") params.set("period", view.period);
  if (view.sort !== DEFAULT_MAINTENANCE_VIEW.sort || view.dir !== DEFAULT_MAINTENANCE_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Any change to what is listed starts again at page 1. */
export const PAGE_RESETTING_KEYS: Array<keyof MaintenanceView> = [
  "status", "q", "propertyId", "priority", "category", "source", "assigned", "price", "visible", "period", "sort", "dir",
];

/** Filters that differ from their default (the status bar is not a filter here). */
export function activeFilterCount(view: MaintenanceView): number {
  let count = 0;
  if (view.q.trim()) count += 1;
  if (view.propertyId) count += 1;
  if (view.priority.length > 0) count += 1;
  if (view.category) count += 1;
  if (view.source.length > 0) count += 1;
  if (view.assigned !== "any") count += 1;
  if (view.price !== "any") count += 1;
  if (view.visible !== "any") count += 1;
  if (view.period !== "any") count += 1;
  return count;
}

export const CLEARED_FILTERS: Partial<MaintenanceView> = {
  q: "", propertyId: "", priority: [], category: "", source: [], assigned: "any", price: "any", visible: "any", period: "any",
};

/** The list page address for a detail page's back link (`?back=`), restricted to this page. */
export function safeBackHref(back: string | null | undefined): string {
  if (!back) return "/v2/admin/maintenance";
  return back.startsWith("/v2/admin/maintenance") && !back.startsWith("//") ? back : "/v2/admin/maintenance";
}
