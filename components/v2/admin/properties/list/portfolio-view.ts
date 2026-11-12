/**
 * The Properties list view lives in the URL (search, chip, client, suburb,
 * one-off sites, view mode, sort, page and the open property), so a reload or
 * a shared link shows the same list. Pure: shared by the server page and the
 * client hooks. `?includeOneOff=1` keeps the old page's link meaning.
 */
import {
  PORTFOLIO_CHIPS,
  PORTFOLIO_SORTS,
  PORTFOLIO_VIEWS,
  type PortfolioChip,
  type PortfolioSort,
  type PortfolioViewMode,
} from "@/lib/properties/portfolio-options";

export type PortfolioView = {
  q: string;
  chip: PortfolioChip | null;
  clientId: string;
  suburb: string;
  includeOneOff: boolean;
  mode: PortfolioViewMode;
  sort: PortfolioSort;
  dir: "asc" | "desc";
  page: number;
  open: string | null;
};

export const DEFAULT_PORTFOLIO_VIEW: PortfolioView = {
  q: "",
  chip: null,
  clientId: "",
  suburb: "",
  includeOneOff: false,
  mode: "list",
  sort: "name",
  dir: "asc",
  page: 1,
  open: null,
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function readPortfolioView(search: string): PortfolioView {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") ?? "1");
  const open = params.get("open");
  const clientId = params.get("clientId") ?? "";
  return {
    q: (params.get("q") ?? "").slice(0, 120),
    chip: oneOf(params.get("chip"), PORTFOLIO_CHIPS),
    clientId: ID_PATTERN.test(clientId) ? clientId : "",
    suburb: (params.get("suburb") ?? "").slice(0, 120),
    includeOneOff: params.get("includeOneOff") === "1",
    mode: oneOf(params.get("view"), PORTFOLIO_VIEWS) ?? DEFAULT_PORTFOLIO_VIEW.mode,
    sort: oneOf(params.get("sort"), PORTFOLIO_SORTS) ?? DEFAULT_PORTFOLIO_VIEW.sort,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    open: open && ID_PATTERN.test(open) ? open : null,
  };
}

/** Filters shared by the list API and the CSV export. */
export function portfolioFilterParams(view: PortfolioView): URLSearchParams {
  const params = new URLSearchParams({ sort: view.sort, dir: view.dir });
  if (view.q.trim()) params.set("q", view.q.trim());
  if (view.chip) params.set("chip", view.chip);
  if (view.clientId) params.set("clientId", view.clientId);
  if (view.suburb) params.set("suburb", view.suburb);
  if (view.includeOneOff) params.set("includeOneOff", "1");
  return params;
}

export function portfolioListQuery(view: PortfolioView, pageSize: number): string {
  const params = portfolioFilterParams(view);
  params.set("shape", "list");
  params.set("page", String(view.page));
  params.set("pageSize", String(pageSize));
  return params.toString();
}

export function portfolioSearch(view: PortfolioView): string {
  const params = new URLSearchParams();
  if (view.q) params.set("q", view.q);
  if (view.chip) params.set("chip", view.chip);
  if (view.clientId) params.set("clientId", view.clientId);
  if (view.suburb) params.set("suburb", view.suburb);
  if (view.includeOneOff) params.set("includeOneOff", "1");
  if (view.mode !== DEFAULT_PORTFOLIO_VIEW.mode) params.set("view", view.mode);
  if (view.sort !== DEFAULT_PORTFOLIO_VIEW.sort || view.dir !== DEFAULT_PORTFOLIO_VIEW.dir) {
    params.set("sort", view.sort);
    params.set("dir", view.dir);
  }
  if (view.page > 1) params.set("page", String(view.page));
  if (view.open) params.set("open", view.open);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Any change to what is listed starts again at page 1. */
export const PORTFOLIO_PAGE_RESETTING_KEYS: Array<keyof PortfolioView> = ["q", "chip", "clientId", "suburb", "includeOneOff", "sort", "dir"];

export function nextPortfolioView(current: PortfolioView, patch: Partial<PortfolioView>): PortfolioView {
  const resetsPage = PORTFOLIO_PAGE_RESETTING_KEYS.some((key) => key in patch);
  return { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
}
