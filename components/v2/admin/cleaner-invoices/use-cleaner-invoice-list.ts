"use client";

/**
 * URL-backed state and the paged read for the cleaner-invoice table, beside
 * `tab=cleaner-invoices`. Each read cancels the previous one and checks
 * cancellation after parsing, so a late answer never fills a newer filter.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  CLEANER_INVOICE_SORTS,
  CLEANER_INVOICE_STATUS_FILTERS,
  type CleanerInvoiceListPayload,
  type CleanerInvoiceSort,
  type CleanerInvoiceStatusFilter,
} from "@/lib/cleaner/invoice-admin-list-types";

export const CLEANER_PAGE_SIZE = 25;

export type CleanerListState = {
  status: CleanerInvoiceStatusFilter;
  cleaner: string;
  from: string;
  to: string;
  q: string;
  sort: CleanerInvoiceSort;
  dir: "asc" | "desc";
  page: number;
};

export const DEFAULT_CLEANER_LIST_STATE: CleanerListState = {
  status: "needs-action",
  cleaner: "",
  from: "",
  to: "",
  q: "",
  sort: "submitted",
  dir: "desc",
  page: 1,
};

const KEYS: Array<keyof CleanerListState> = ["status", "cleaner", "from", "to", "q", "sort", "dir", "page"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readCleanerListState(params: URLSearchParams): CleanerListState {
  const page = Number(params.get("page"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    status: pick(params.get("status"), CLEANER_INVOICE_STATUS_FILTERS, DEFAULT_CLEANER_LIST_STATE.status),
    cleaner: (params.get("cleaner") ?? "").slice(0, 64),
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    q: (params.get("q") ?? "").slice(0, 100),
    sort: pick(params.get("sort"), CLEANER_INVOICE_SORTS, DEFAULT_CLEANER_LIST_STATE.sort),
    dir: params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : DEFAULT_CLEANER_LIST_STATE.dir,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

export function writeCleanerListState(base: URLSearchParams, state: CleanerListState): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const key of KEYS) {
    const value = state[key];
    if (value === DEFAULT_CLEANER_LIST_STATE[key] || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

export function cleanerListApiQuery(state: CleanerListState): string {
  const params = new URLSearchParams({
    paginated: "1",
    status: state.status,
    sort: state.sort,
    dir: state.dir,
    page: String(state.page),
    pageSize: String(CLEANER_PAGE_SIZE),
  });
  if (state.cleaner) params.set("cleaner", state.cleaner);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.q.trim()) params.set("q", state.q.trim());
  return params.toString();
}

export function cleanerFilterSignature(state: CleanerListState): string {
  return JSON.stringify([state.status, state.cleaner, state.from, state.to, state.q.trim(), state.sort, state.dir]);
}

const currentQuery = () => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);

export function useCleanerListState(): [CleanerListState, (patch: Partial<CleanerListState>) => void] {
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? null;
  const [state, setState] = React.useState<CleanerListState>(() =>
    readCleanerListState(searchString !== null ? new URLSearchParams(searchString) : currentQuery()),
  );
  React.useEffect(() => {
    if (searchString === null) return;
    const fromUrl = readCleanerListState(new URLSearchParams(searchString));
    setState((previous) => (JSON.stringify(previous) === JSON.stringify(fromUrl) ? previous : fromUrl));
  }, [searchString]);

  const stateRef = React.useRef(state);
  stateRef.current = state;
  const update = React.useCallback((patch: Partial<CleanerListState>) => {
    const resetsPage = Object.keys(patch).some((key) => key !== "page");
    const next = { ...stateRef.current, ...patch, ...(resetsPage && patch.page === undefined ? { page: 1 } : {}) };
    stateRef.current = next;
    setState(next);
    if (typeof window !== "undefined") {
      const query = writeCleanerListState(currentQuery(), next).toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);
  return [state, update];
}

function isPayload(body: unknown): body is CleanerInvoiceListPayload {
  const value = body as CleanerInvoiceListPayload | null;
  return Boolean(value) && Array.isArray(value!.rows) && typeof value!.total === "number" && typeof value!.counts === "object";
}

export function useCleanerListData(state: CleanerListState) {
  const query = cleanerListApiQuery(state);
  const [loaded, setLoaded] = React.useState<{ query: string; payload: CleanerInvoiceListPayload } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ query: string; message: string } | null>(null);
  const [token, setToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/admin/cleaner-invoices?${query}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isPayload(body)) {
          const message = (body as { error?: unknown } | null)?.error;
          setError({ query, message: typeof message === "string" ? message : "Cleaner invoices could not be loaded." });
          return;
        }
        setLoaded({ query, payload: body });
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError({ query, message: cause instanceof Error && cause.message ? cause.message : "Cleaner invoices could not be loaded." });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, token]);

  const reload = React.useCallback(() => setToken((value) => value + 1), []);
  return {
    payload: loaded?.query === query ? loaded.payload : null,
    loading,
    error: error?.query === query ? error.message : null,
    reload,
  };
}
