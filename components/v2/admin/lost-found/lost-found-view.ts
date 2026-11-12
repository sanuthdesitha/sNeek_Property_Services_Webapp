/**
 * The Lost and found view lives in the URL (stage tab, filters, sort, page and
 * the open item), so a reload or a shared link shows the same list. Pure:
 * shared by the server page and the client hook.
 */
import { CLOSED_STATUSES } from "@/lib/lost-found/status";
import { LOST_FOUND_SORTS, LOST_FOUND_TABS, VALUE_FILTERS, type LostFoundSort, type LostFoundTab, type ValueFilter } from "@/lib/lost-found/list-options";

export type LostFoundView = {
  tab: LostFoundTab;
  closedAs: string;
  q: string;
  propertyId: string;
  from: string;
  to: string;
  value: ValueFilter;
  holding: boolean;
  /** Wave F: only items still at New found more than 14 days ago (`?flag=new-stale`). */
  staleNew: boolean;
  sort: LostFoundSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_VIEW: LostFoundView = {
  tab: "new", closedAs: "", q: "", propertyId: "", from: "", to: "", value: "any", holding: false, staleNew: false, sort: "found", dir: "asc", page: 1, open: null,
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readLostFoundView(search: string): LostFoundView {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  const closedAs = params.get("closedAs") ?? "";
  const day = (key: string) => {
    const value = params.get(key) ?? "";
    return DAY_PATTERN.test(value) ? value : "";
  };
  return {
    tab: oneOf(params.get("stage"), LOST_FOUND_TABS, DEFAULT_VIEW.tab),
    closedAs: (CLOSED_STATUSES as string[]).includes(closedAs) ? closedAs : "",
    q: params.get("q") ?? "",
    propertyId: params.get("propertyId") ?? "",
    from: day("from"),
    to: day("to"),
    value: oneOf(params.get("value"), VALUE_FILTERS, "any"),
    holding: params.get("holding") === "past",
    staleNew: params.get("flag") === "new-stale",
    sort: oneOf(params.get("sort"), LOST_FOUND_SORTS, DEFAULT_VIEW.sort),
    dir: params.get("dir") === "desc" ? "desc" : params.get("dir") === "asc" ? "asc" : DEFAULT_VIEW.dir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

/** Filter parameters shared by the list API and the CSV export. */
function filterParams(view: LostFoundView): URLSearchParams {
  const params = new URLSearchParams({ stage: view.tab, sort: view.sort, dir: view.dir });
  if (view.tab === "closed" && view.closedAs) params.set("closedAs", view.closedAs);
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.propertyId) params.set("propertyId", view.propertyId);
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  if (view.value !== "any") params.set("value", view.value);
  if (view.holding) params.set("holding", "past");
  if (view.staleNew) params.set("flag", "new-stale");
  return params;
}

export function listQueryString(view: LostFoundView, pageSize: number): string {
  const params = filterParams(view);
  params.set("paginated", "1");
  params.set("page", String(view.page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export function exportQueryString(view: LostFoundView): string {
  return filterParams(view).toString();
}

export function viewSearch(view: LostFoundView): string {
  const params = new URLSearchParams();
  if (view.tab !== DEFAULT_VIEW.tab) params.set("stage", view.tab);
  if (view.tab === "closed" && view.closedAs) params.set("closedAs", view.closedAs);
  if (view.q) params.set("q", view.q);
  if (view.propertyId) params.set("propertyId", view.propertyId);
  if (view.from) params.set("from", view.from);
  if (view.to) params.set("to", view.to);
  if (view.value !== "any") params.set("value", view.value);
  if (view.holding) params.set("holding", "past");
  if (view.staleNew) params.set("flag", "new-stale");
  if (view.sort !== DEFAULT_VIEW.sort || view.dir !== DEFAULT_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Any change to what is listed starts again at page 1. */
export const PAGE_RESETTING_KEYS: Array<keyof LostFoundView> = ["tab", "closedAs", "q", "propertyId", "from", "to", "value", "holding", "staleNew", "sort", "dir"];
