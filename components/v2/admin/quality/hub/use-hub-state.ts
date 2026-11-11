"use client";

/**
 * URL-backed state for the Quality hub: tab, period, shared filters, the
 * Issues tab's own filters, and the active tab's sort / page.
 *
 * Filter, sort and page changes use history.replaceState (Next 14.2 keeps
 * useSearchParams in step) so the server page is not re-rendered for every
 * chip; tab changes are real links. Anything other than the page itself
 * resets the page to 1. External navigation (a link, back/forward) is
 * followed.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { parseIssueFiltersLenient, writeFilters } from "@/lib/quality/filters";
import { periodQuery, resolveQualityPeriodLenient, type QualityPeriod } from "@/lib/quality/period";
import { QUALITY_TABS, type IssueListFilters, type QualityTab } from "@/lib/quality/types";

export type HubState = {
  tab: QualityTab;
  period: QualityPeriod;
  filters: IssueListFilters;
  /** Active tab's sort key ("" = the tab's default). Each tab validates it. */
  sort: string;
  dir: "asc" | "desc" | "";
  page: number;
};

export type HubPatch = Partial<Omit<HubState, "period" | "filters" | "tab">> & {
  period?: Pick<QualityPeriod, "key" | "fromKey" | "toKey">;
  filters?: Partial<IssueListFilters>;
};

function currentQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

export function readHubState(params: URLSearchParams, allowedTabs: readonly QualityTab[], defaultTab: QualityTab): HubState {
  const rawTab = params.get("tab") ?? "";
  const tab = (QUALITY_TABS as readonly string[]).includes(rawTab) && allowedTabs.includes(rawTab as QualityTab)
    ? (rawTab as QualityTab)
    : defaultTab;
  const page = Number(params.get("page"));
  const dir = params.get("dir");
  return {
    tab,
    period: resolveQualityPeriodLenient({ period: params.get("period"), from: params.get("from"), to: params.get("to") }),
    filters: parseIssueFiltersLenient(params),
    sort: (params.get("sort") ?? "").slice(0, 32),
    dir: dir === "asc" || dir === "desc" ? dir : "",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Writes the state into `base`, leaving unrelated params alone. */
export function writeHubState(base: URLSearchParams, state: HubState): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  next.set("tab", state.tab);
  for (const key of ["period", "from", "to"]) next.delete(key);
  const period = periodQuery(state.period);
  if (!(period.period === "30d" && Object.keys(period).length === 1)) {
    for (const [key, value] of Object.entries(period)) next.set(key, value);
  }
  writeFilters(next, state.filters);
  if (state.sort) next.set("sort", state.sort);
  else next.delete("sort");
  if (state.dir) next.set("dir", state.dir);
  else next.delete("dir");
  if (state.page > 1) next.set("page", String(state.page));
  else next.delete("page");
  return next;
}

/** Period + shared filters as an API query (what every tab's read is keyed on). */
export function hubApiQuery(
  state: { period: HubState["period"]; filters: Partial<IssueListFilters> },
  extra: Record<string, string> = {},
): URLSearchParams {
  const params = new URLSearchParams(periodQuery(state.period));
  writeFilters(params, state.filters);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return params;
}

export function useHubState(
  allowedTabs: readonly QualityTab[],
  defaultTab: QualityTab,
): { state: HubState; update: (patch: HubPatch) => void; hrefForTab: (tab: QualityTab, extra?: Partial<IssueListFilters>) => string } {
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? null;
  const [state, setState] = React.useState<HubState>(() =>
    readHubState(searchString !== null ? new URLSearchParams(searchString) : currentQuery(), allowedTabs, defaultTab),
  );

  React.useEffect(() => {
    if (searchString === null) return;
    const fromUrl = readHubState(new URLSearchParams(searchString), allowedTabs, defaultTab);
    setState((previous) => (JSON.stringify(previous) === JSON.stringify(fromUrl) ? previous : fromUrl));
  }, [searchString, allowedTabs, defaultTab]);

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const update = React.useCallback((patch: HubPatch) => {
    const previous = stateRef.current;
    const resetsPage = Object.keys(patch).some((key) => key !== "page");
    const period = patch.period
      ? resolveQualityPeriodLenient({ period: patch.period.key, from: patch.period.fromKey, to: patch.period.toKey })
      : previous.period;
    const next: HubState = {
      ...previous,
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      ...(patch.dir !== undefined ? { dir: patch.dir } : {}),
      period,
      filters: { ...previous.filters, ...(patch.filters ?? {}) },
      page: patch.page ?? (resetsPage ? 1 : previous.page),
    };
    stateRef.current = next;
    setState(next);
    if (typeof window !== "undefined") {
      const query = writeHubState(currentQuery(), next).toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  const hrefForTab = React.useCallback(
    (tab: QualityTab, extra: Partial<IssueListFilters> = {}) => {
      const current = stateRef.current;
      const next: HubState = { ...current, tab, filters: { ...current.filters, ...extra }, sort: "", dir: "", page: 1 };
      return `/v2/admin/quality?${writeHubState(new URLSearchParams(), next).toString()}`;
    },
    // Recomputed on every state change so links always carry the current filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  return { state, update, hrefForTab };
}
