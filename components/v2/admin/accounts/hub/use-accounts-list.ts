"use client";

/**
 * Reads one page of the Accounts list. A newer read aborts the older one and
 * every answer is checked against the request that is still current after
 * parsing, so a slow response can never replace a newer list. On failure the
 * last good list stays on screen (stale) with the error beside it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountListResponse } from "@/lib/accounts/list/types";
import { listQueryString, type AccountsView } from "./accounts-url";

export const ACCOUNTS_PAGE_SIZE = 25;

export type AccountsListState = {
  data: AccountListResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

async function readList(query: string, signal: AbortSignal): Promise<AccountListResponse> {
  const response = await fetch(`/api/admin/users?${query}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as (AccountListResponse & { error?: string }) | null;
  if (!response.ok || !body || !Array.isArray(body.rows)) {
    throw new Error(body?.error ?? `Could not load accounts (${response.status}).`);
  }
  return body;
}

export function useAccountsList(view: AccountsView): AccountsListState {
  const [data, setData] = useState<AccountListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const query = listQueryString(view, ACCOUNTS_PAGE_SIZE);

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = `${query}#${revision}`;
    current.current = requestKey;
    setLoading(true);
    readList(query, controller.signal)
      .then((body) => {
        if (controller.signal.aborted || current.current !== requestKey) return;
        setData(body);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || current.current !== requestKey) return;
        setError(reason instanceof Error ? reason.message : "Could not load accounts.");
      })
      .finally(() => {
        if (!controller.signal.aborted && current.current === requestKey) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}
