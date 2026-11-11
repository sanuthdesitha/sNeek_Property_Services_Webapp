"use client";

/**
 * URL-backed list state and the paged read for the client-invoice table.
 *
 * Filter, sort and page live in the query string beside `tab=invoices`, so a
 * view survives refresh and can be linked. Updates use history.replaceState
 * (Next 14.2 keeps useSearchParams in step) so the server page around the tab
 * is not re-rendered for every chip. Each read cancels the previous one and
 * re-checks cancellation after parsing, so a late answer can never overwrite a
 * newer filter's rows.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  CLIENT_INVOICE_SORTS,
  CLIENT_INVOICE_STATUS_FILTERS,
  CLIENT_INVOICE_XERO_FILTERS,
  type ClientInvoiceListPayload,
  type ClientInvoiceSort,
  type ClientInvoiceStatusFilter,
  type ClientInvoiceXeroFilter,
} from "@/lib/billing/client-invoice-list-types";

export const INVOICE_PAGE_SIZE = 25;

export type InvoiceListState = {
  status: ClientInvoiceStatusFilter;
  client: string;
  from: string;
  to: string;
  xero: ClientInvoiceXeroFilter;
  q: string;
  sort: ClientInvoiceSort;
  dir: "asc" | "desc";
  page: number;
};

export const DEFAULT_LIST_STATE: InvoiceListState = {
  status: "active",
  client: "",
  from: "",
  to: "",
  xero: "any",
  q: "",
  sort: "created",
  dir: "desc",
  page: 1,
};

const STATE_KEYS: Array<keyof InvoiceListState> = ["status", "client", "from", "to", "xero", "q", "sort", "dir", "page"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Reads the list state from a query string. Unknown values fall back to defaults. */
export function readListState(params: URLSearchParams): InvoiceListState {
  const page = Number(params.get("page"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    status: pick(params.get("status"), CLIENT_INVOICE_STATUS_FILTERS, DEFAULT_LIST_STATE.status),
    client: (params.get("client") ?? "").slice(0, 64),
    from: DAY.test(from) ? from : "",
    to: DAY.test(to) ? to : "",
    xero: pick(params.get("xero"), CLIENT_INVOICE_XERO_FILTERS, DEFAULT_LIST_STATE.xero),
    q: (params.get("q") ?? "").slice(0, 100),
    sort: pick(params.get("sort"), CLIENT_INVOICE_SORTS, DEFAULT_LIST_STATE.sort),
    dir: params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : DEFAULT_LIST_STATE.dir,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Writes non-default state into `base`, leaving unrelated params (tab) alone. */
export function writeListState(base: URLSearchParams, state: InvoiceListState): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const key of STATE_KEYS) {
    const value = state[key];
    if (value === DEFAULT_LIST_STATE[key] || value === "") next.delete(key);
    else next.set(key, String(value));
  }
  return next;
}

/** Query for the list API: always explicit, plus paging. */
export function listApiQuery(state: InvoiceListState): string {
  const params = new URLSearchParams({
    paginated: "1",
    status: state.status,
    xero: state.xero,
    sort: state.sort,
    dir: state.dir,
    page: String(state.page),
    pageSize: String(INVOICE_PAGE_SIZE),
  });
  if (state.client) params.set("client", state.client);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.q.trim()) params.set("q", state.q.trim());
  return params.toString();
}

/** The filter half only: used to reset selection when the filter set changes. */
export function filterSignature(state: InvoiceListState): string {
  return JSON.stringify([state.status, state.client, state.from, state.to, state.xero, state.q.trim(), state.sort, state.dir]);
}

function currentQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

export function useInvoiceListState(): [InvoiceListState, (patch: Partial<InvoiceListState>) => void] {
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? null;
  const [state, setState] = React.useState<InvoiceListState>(() =>
    readListState(searchString !== null ? new URLSearchParams(searchString) : currentQuery()),
  );

  // Follow external navigation (a link, back/forward) to a different view.
  React.useEffect(() => {
    if (searchString === null) return;
    const fromUrl = readListState(new URLSearchParams(searchString));
    setState((previous) => (JSON.stringify(previous) === JSON.stringify(fromUrl) ? previous : fromUrl));
  }, [searchString]);

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const update = React.useCallback((patch: Partial<InvoiceListState>) => {
    const previous = stateRef.current;
    // Any change other than the page itself goes back to page 1.
    const resetsPage = Object.keys(patch).some((key) => key !== "page");
    const next = { ...previous, ...patch, ...(resetsPage && patch.page === undefined ? { page: 1 } : {}) };
    stateRef.current = next;
    setState(next);
    if (typeof window !== "undefined") {
      const query = writeListState(currentQuery(), next).toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  return [state, update];
}

export type InvoiceListData = {
  payload: ClientInvoiceListPayload | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

function isPayload(body: unknown): body is ClientInvoiceListPayload {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as ClientInvoiceListPayload).rows) &&
    typeof (body as ClientInvoiceListPayload).total === "number" && typeof (body as ClientInvoiceListPayload).counts === "object";
}

export function useInvoiceListData(state: InvoiceListState): InvoiceListData {
  const query = listApiQuery(state);
  // The payload remembers which query produced it: rows from a different
  // filter are never shown as if they answered the current one.
  const [loaded, setLoaded] = React.useState<{ query: string; payload: ClientInvoiceListPayload } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ query: string; message: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/admin/invoices?${query}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isPayload(body)) {
          const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "The invoice list could not be loaded.";
          setError({ query, message });
          return;
        }
        setLoaded({ query, payload: body });
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError({ query, message: cause instanceof Error && cause.message ? cause.message : "The invoice list could not be loaded." });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, reloadToken]);

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);
  return {
    payload: loaded?.query === query ? loaded.payload : null,
    loading,
    error: error?.query === query ? error.message : null,
    reload,
  };
}
