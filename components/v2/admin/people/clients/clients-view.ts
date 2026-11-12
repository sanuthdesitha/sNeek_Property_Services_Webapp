/**
 * People › Clients view state, kept in the URL (filter, search, sort, page and
 * the open client) so a reload or a shared link shows the same list. Pure.
 */
import { CLIENT_DIRECTORY_FILTERS, CLIENT_DIRECTORY_SORTS, DEFAULT_CLIENT_FILTER, type ClientDirectoryFilter, type ClientDirectorySort } from "@/lib/people/clients/types";

export type ClientsView = {
  filter: ClientDirectoryFilter;
  q: string;
  sort: ClientDirectorySort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_CLIENTS_VIEW: ClientsView = { filter: DEFAULT_CLIENT_FILTER, q: "", sort: "name", dir: "asc", page: 1, open: null };
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function readClientsView(search: string): ClientsView {
  const params = new URLSearchParams(search);
  const filter = params.get("filter") ?? DEFAULT_CLIENTS_VIEW.filter;
  const sort = params.get("sort") ?? DEFAULT_CLIENTS_VIEW.sort;
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  return {
    filter: (CLIENT_DIRECTORY_FILTERS as readonly string[]).includes(filter) ? (filter as ClientDirectoryFilter) : DEFAULT_CLIENTS_VIEW.filter,
    q: params.get("q") ?? "",
    sort: (CLIENT_DIRECTORY_SORTS as readonly string[]).includes(sort) ? (sort as ClientDirectorySort) : DEFAULT_CLIENTS_VIEW.sort,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

export const CLIENTS_PAGE_SIZE = 25;

export function clientsListQuery(view: ClientsView, pageSize = CLIENTS_PAGE_SIZE): string {
  const params = new URLSearchParams({ filter: view.filter, sort: view.sort, dir: view.dir, page: String(view.page), pageSize: String(pageSize) });
  if (view.q.trim()) params.set("q", view.q.trim());
  return params.toString();
}

export function clientsViewSearch(view: ClientsView): string {
  const params = new URLSearchParams({ tab: "clients" });
  if (view.filter !== DEFAULT_CLIENTS_VIEW.filter) params.set("filter", view.filter);
  if (view.q) params.set("q", view.q);
  if (view.sort !== DEFAULT_CLIENTS_VIEW.sort || view.dir !== DEFAULT_CLIENTS_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  return `?${params.toString()}`;
}

/** Any change to what is listed starts again at page 1. */
export function patchClientsView(current: ClientsView, patch: Partial<ClientsView>): ClientsView {
  const resetsPage = ["filter", "q", "sort", "dir"].some((key) => key in patch);
  return { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
}
