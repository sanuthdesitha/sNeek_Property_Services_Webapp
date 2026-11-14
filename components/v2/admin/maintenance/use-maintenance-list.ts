"use client";

/**
 * Reads one page of the Maintenance list. A newer read aborts the older one
 * and every answer is checked against the request still current after
 * parsing, so a slow response never fills a different filter set. On failure
 * the last good list stays on screen (stale) with the time it was loaded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MaintenanceListResponse } from "@/lib/maintenance/admin-list-types";
import { listQueryString, MAINTENANCE_PAGE_SIZE, type MaintenanceView } from "./maintenance-view";

export type MaintenanceListState = {
  data: MaintenanceListResponse | null;
  /** When `data` was read (ms), for the stale line. */
  loadedAt: number | null;
  loading: boolean;
  error: string | null;
  /** The query `data` answers; differs from the current one while a new read runs. */
  dataQuery: string | null;
  query: string;
  reload: () => void;
};

async function readList(query: string, signal: AbortSignal): Promise<MaintenanceListResponse> {
  const response = await fetch(`/api/admin/maintenance?${query}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as (MaintenanceListResponse & { error?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.rows)) {
    throw new Error(body?.error ?? `The list could not be loaded (${response.status}).`);
  }
  return body;
}

export function useMaintenanceList(view: MaintenanceView, enabled = true): MaintenanceListState {
  const [data, setData] = useState<MaintenanceListResponse | null>(null);
  const [dataQuery, setDataQuery] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const query = listQueryString(view, MAINTENANCE_PAGE_SIZE);

  useEffect(() => {
    if (!enabled) return;
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
          setDataQuery(query);
          setLoadedAt(Date.now());
          setError(null);
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted || current.current !== requestKey) return;
          setError(reason instanceof Error ? reason.message : "The list could not be loaded.");
        })
        .finally(() => {
          if (!controller.signal.aborted && current.current === requestKey) setLoading(false);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, enabled]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loadedAt, loading, error, dataQuery, query, reload };
}
