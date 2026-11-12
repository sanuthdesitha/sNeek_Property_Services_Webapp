"use client";

/**
 * URL-backed Insights state. Period, client, sort and page changes use
 * history.replaceState (Next 14.2 keeps useSearchParams in step), so the
 * server page is not re-rendered for every chip; tab changes are links. A
 * change of period or client resets the page; back/forward is followed.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { readInsightsState, writeInsightsState, type InsightsUrlState } from "@/lib/insights/url-state";
import { resolveInsightsPeriodLenient, type InsightsPeriod } from "@/lib/insights/period";
import type { InsightsTab } from "@/lib/insights/types";

export type InsightsPatch = {
  period?: Pick<InsightsPeriod, "key" | "fromKey" | "toKey">;
  clientId?: string;
  sort?: string;
  dir?: "asc" | "desc" | "";
  page?: number;
};

function currentQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

export const INSIGHTS_PATH = "/v2/admin/reports";

export function useInsightsState(): {
  state: InsightsUrlState;
  update: (patch: InsightsPatch) => void;
  hrefForTab: (tab: InsightsTab) => string;
} {
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? null;
  const [state, setState] = React.useState<InsightsUrlState>(() =>
    readInsightsState(searchString !== null ? new URLSearchParams(searchString) : currentQuery()),
  );

  React.useEffect(() => {
    if (searchString === null) return;
    const fromUrl = readInsightsState(new URLSearchParams(searchString));
    setState((previous) => (JSON.stringify(previous) === JSON.stringify(fromUrl) ? previous : fromUrl));
  }, [searchString]);

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const update = React.useCallback((patch: InsightsPatch) => {
    const previous = stateRef.current;
    const scopeChanged = patch.period !== undefined || patch.clientId !== undefined || patch.sort !== undefined || patch.dir !== undefined;
    const next: InsightsUrlState = {
      ...previous,
      period: patch.period
        ? resolveInsightsPeriodLenient({ period: patch.period.key, from: patch.period.fromKey, to: patch.period.toKey })
        : previous.period,
      clientId: patch.clientId ?? previous.clientId,
      sort: patch.sort ?? previous.sort,
      dir: patch.dir ?? previous.dir,
      page: patch.page ?? (scopeChanged ? 1 : previous.page),
    };
    stateRef.current = next;
    setState(next);
    if (typeof window !== "undefined") {
      const query = writeInsightsState(currentQuery(), next).toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}`);
    }
  }, []);

  const hrefForTab = React.useCallback(
    (tab: InsightsTab) => {
      const current = stateRef.current;
      const next: InsightsUrlState = { ...current, tab, sort: "", dir: "", page: 1 };
      return `${INSIGHTS_PATH}?${writeInsightsState(new URLSearchParams(), next).toString()}`;
    },
    // Recomputed on every state change so tab links carry the current period and client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  );

  return { state, update, hrefForTab };
}
