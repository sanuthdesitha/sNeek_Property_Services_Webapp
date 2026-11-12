"use client";

/**
 * Reads one page of the Lost and found list. A newer read aborts the older one
 * and every answer is checked against the request still current after parsing,
 * so a slow response never replaces a newer list. On failure the last good
 * list stays on screen (stale) with the error beside it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LostFoundListResponse } from "@/lib/lost-found/list";
import { listQueryString, type LostFoundView } from "./lost-found-view";

export const LOST_FOUND_PAGE_SIZE = 25;

export type LostFoundListState = {
  data: LostFoundListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

async function readList(query: string, signal: AbortSignal): Promise<LostFoundListResponse> {
  const response = await fetch(`/api/admin/lost-found?${query}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as (LostFoundListResponse & { error?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.rows)) {
    throw new Error(body?.error ?? `Could not load lost and found (${response.status}).`);
  }
  return body;
}

export function useLostFoundList(view: LostFoundView): LostFoundListState {
  const [data, setData] = useState<LostFoundListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const query = listQueryString(view, LOST_FOUND_PAGE_SIZE);

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
          setError(reason instanceof Error ? reason.message : "Could not load lost and found.");
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
