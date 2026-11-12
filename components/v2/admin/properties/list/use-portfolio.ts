"use client";

/**
 * The Properties list view in the URL (replaceState, Back/Forward followed)
 * and the page read: a newer read aborts the older one and every answer is
 * checked against the request still current after parsing, so a slow response
 * never replaces a newer list. On failure the last good list stays (stale).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioListResponse } from "@/lib/properties/portfolio-options";
import { nextPortfolioView, portfolioListQuery, portfolioSearch, readPortfolioView, type PortfolioView } from "./portfolio-view";

export const PORTFOLIO_PAGE_SIZE = 25;

export function usePortfolioView(initial: PortfolioView): [PortfolioView, (patch: Partial<PortfolioView>) => void] {
  const [view, setView] = useState<PortfolioView>(initial);

  useEffect(() => {
    const sync = () => setView(readPortfolioView(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: Partial<PortfolioView>) => {
    setView((current) => {
      const next = nextPortfolioView(current, patch);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${portfolioSearch(next)}${window.location.hash}`);
      return next;
    });
  }, []);

  return [view, update];
}

export type PortfolioListState = {
  data: PortfolioListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

async function readList(query: string, signal: AbortSignal): Promise<PortfolioListResponse> {
  const response = await fetch(`/api/admin/properties?${query}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as (PortfolioListResponse & { error?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.rows)) {
    throw new Error(body?.error ?? `Could not load properties (${response.status}).`);
  }
  return body;
}

export function usePortfolioList(view: PortfolioView): PortfolioListState {
  const [data, setData] = useState<PortfolioListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const query = portfolioListQuery(view, PORTFOLIO_PAGE_SIZE);

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = `${query}#${revision}`;
    current.current = requestKey;
    setLoading(true);
    // Search typing: wait briefly so each keystroke is not a request.
    const timer = window.setTimeout(() => {
      readList(query, controller.signal)
        .then((body) => {
          if (controller.signal.aborted || current.current !== requestKey) return;
          setData(body);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || current.current !== requestKey) return;
          setError(reason instanceof Error ? reason.message : "Could not load properties.");
        })
        .finally(() => {
          if (!controller.signal.aborted && current.current === requestKey) setLoading(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}
