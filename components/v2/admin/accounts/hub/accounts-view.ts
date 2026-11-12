/**
 * The Accounts hub's view lives in the URL (tab, search, status, documents,
 * role, sort, page and the open person), so a reload or a shared link shows
 * the same list. Old `?tab=team|…` values are read through the shared tab map.
 * Pure: shared by the server page and the client hook (./accounts-url).
 */
import { normalizeAccountTab, type AccountTab } from "@/lib/accounts/list/tabs";
import { ACCOUNT_SORTS, ACCOUNT_STATUS_FILTERS, type AccountSort, type AccountStatusFilter } from "@/lib/accounts/list/types";

export type AccountsView = {
  tab: AccountTab;
  q: string;
  status: AccountStatusFilter;
  documents: boolean;
  /** `rate=none`: people with no default pay rate. */
  noRate: boolean;
  role: string;
  sort: AccountSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_VIEW: AccountsView = { tab: "everyone", q: "", status: "all", documents: false, noRate: false, role: "", sort: "name", dir: "asc", page: 1, open: null };
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function readAccountsView(search: string): AccountsView {
  const params = new URLSearchParams(search);
  const status = params.get("status") ?? "all";
  const sort = params.get("sort") ?? DEFAULT_VIEW.sort;
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  return {
    tab: normalizeAccountTab(params.get("tab")),
    q: params.get("q") ?? "",
    status: (ACCOUNT_STATUS_FILTERS as readonly string[]).includes(status) ? (status as AccountStatusFilter) : "all",
    documents: params.get("documents") === "1",
    noRate: params.get("rate") === "none",
    role: params.get("role") ?? "",
    sort: (ACCOUNT_SORTS as readonly string[]).includes(sort) ? (sort as AccountSort) : DEFAULT_VIEW.sort,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

/** Query for the list API (and the export): the view without the open person. */
export function listQueryString(view: AccountsView, pageSize: number): string {
  const params = new URLSearchParams({ paginated: "1", tab: view.tab, sort: view.sort, dir: view.dir, page: String(view.page), pageSize: String(pageSize) });
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.status !== "all") params.set("status", view.status);
  if (view.documents) params.set("documents", "1");
  if (view.noRate) params.set("rate", "none");
  if (view.role) params.set("role", view.role);
  return params.toString();
}

/**
 * `urlTab`: the People route names some lists differently (Client logins is
 * `tab=logins` there), so it writes its own tab value; the list is the same.
 */
export function viewSearch(view: AccountsView, urlTab?: string): string {
  const params = new URLSearchParams();
  if (urlTab) params.set("tab", urlTab);
  else if (view.tab !== DEFAULT_VIEW.tab) params.set("tab", view.tab);
  if (view.q) params.set("q", view.q);
  if (view.status !== "all") params.set("status", view.status);
  if (view.documents) params.set("documents", "1");
  if (view.noRate) params.set("rate", "none");
  if (view.role) params.set("role", view.role);
  if (view.sort !== DEFAULT_VIEW.sort || view.dir !== DEFAULT_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  const query = params.toString();
  return query ? `?${query}` : "";
}
