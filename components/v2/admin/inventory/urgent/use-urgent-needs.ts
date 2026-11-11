"use client";

/**
 * The Urgent needs view (URL-backed) and one page of the all-property list.
 * A newer read aborts the older one and every answer is checked against the
 * request still current after parsing; a failed read keeps the last good list
 * on screen as stale.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { UrgentNeedListResponse } from "@/lib/inventory/urgent-stock-list";
import { readUrgentView, URGENT_PAGE_RESETTING_KEYS, urgentListQuery, urgentViewSearch, type UrgentView } from "./urgent-view";

export const URGENT_PAGE_SIZE = 25;

export function useUrgentView(initial: UrgentView): [UrgentView, (patch: Partial<UrgentView>) => void] {
  const [view, setView] = useState<UrgentView>(initial);
  useEffect(() => {
    const sync = () => setView(readUrgentView(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const update = useCallback((patch: Partial<UrgentView>) => {
    setView((current) => {
      const resetsPage = URGENT_PAGE_RESETTING_KEYS.some((key) => key in patch);
      const next: UrgentView = { ...current, ...patch, page: patch.page ?? (resetsPage ? 1 : current.page) };
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${urgentViewSearch(next)}${window.location.hash}`);
      return next;
    });
  }, []);
  return [view, update];
}

export type UrgentListState = { data: UrgentNeedListResponse | null; loading: boolean; error: string | null; reload: () => void };

async function readList(query: string, signal: AbortSignal): Promise<UrgentNeedListResponse> {
  const response = await fetch(`/api/inventory/urgent-stock?${query}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as (UrgentNeedListResponse & { error?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error ?? `Could not load urgent needs (${response.status}).`);
  return body;
}

export function useUrgentNeeds(view: UrgentView): UrgentListState {
  const [data, setData] = useState<UrgentNeedListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const query = urgentListQuery(view, URGENT_PAGE_SIZE);
  useEffect(() => {
    const controller = new AbortController();
    const requestKey = `${query}#${revision}`;
    current.current = requestKey;
    setLoading(true);
    const timer = window.setTimeout(() => {
      readList(query, controller.signal)
        .then((body) => {
          if (controller.signal.aborted || current.current !== requestKey) return;
          setData(body);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || current.current !== requestKey) return;
          setError(reason instanceof Error ? reason.message : "Could not load urgent needs.");
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
