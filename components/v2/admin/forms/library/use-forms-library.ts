"use client";

/**
 * URL-backed state and reads for the Job forms tab.
 *
 * Filters, sort and page live in the query string beside `tab`, so a view
 * survives refresh and can be linked (history.replaceState; the server page
 * around the tab is not re-rendered for each change). Each read cancels the
 * previous one and re-checks cancellation after parsing, and the payload
 * remembers the query that produced it, so rows from an older filter are never
 * shown as the answer to a newer one.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  FORM_LIBRARY_SCOPES,
  FORM_LIBRARY_SORTS,
  FORM_LIBRARY_STATUSES,
  FORM_LIBRARY_USED_BY,
  type FormGroupSummary,
  type FormLibraryFilters,
  type FormLibraryPayload,
  type FormLibrarySort,
} from "@/lib/forms/library-types";

export const FORMS_PAGE_SIZE = 25;

export type FormsListState = FormLibraryFilters & { sort: FormLibrarySort; dir: "asc" | "desc"; page: number };

export const DEFAULT_FORMS_STATE: FormsListState = {
  scope: "active",
  group: "",
  tag: "",
  status: "any",
  usedBy: "any",
  problems: false,
  q: "",
  sort: "name",
  dir: "asc",
  page: 1,
};

const KEYS: Array<keyof FormsListState> = ["scope", "group", "tag", "status", "usedBy", "problems", "q", "sort", "dir", "page"];

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readFormsState(params: URLSearchParams): FormsListState {
  const page = Number(params.get("page"));
  return {
    scope: pick(params.get("scope"), FORM_LIBRARY_SCOPES, "active"),
    group: (params.get("group") ?? "").slice(0, 64),
    tag: (params.get("tag") ?? "").slice(0, 40),
    status: pick(params.get("status"), FORM_LIBRARY_STATUSES, "any"),
    usedBy: pick(params.get("usedBy"), FORM_LIBRARY_USED_BY, "any"),
    problems: params.get("problems") === "1",
    q: (params.get("q") ?? "").slice(0, 100),
    sort: pick(params.get("sort"), FORM_LIBRARY_SORTS, "name"),
    dir: params.get("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

function encode(value: FormsListState[keyof FormsListState]): string {
  return typeof value === "boolean" ? (value ? "1" : "") : String(value);
}

/** Non-default state written into `base`; unrelated params (tab) are kept. */
export function writeFormsState(base: URLSearchParams, state: FormsListState): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  for (const key of KEYS) {
    const value = encode(state[key]);
    if (value === encode(DEFAULT_FORMS_STATE[key]) || value === "") next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function formsApiQuery(state: FormsListState): string {
  const params = new URLSearchParams({
    scope: state.scope,
    status: state.status,
    usedBy: state.usedBy,
    sort: state.sort,
    dir: state.dir,
    page: String(state.page),
    pageSize: String(FORMS_PAGE_SIZE),
  });
  if (state.group) params.set("group", state.group);
  if (state.tag) params.set("tag", state.tag);
  if (state.problems) params.set("problems", "1");
  if (state.q.trim()) params.set("q", state.q.trim());
  return params.toString();
}

/** The filter half only: selection is kept while this stays the same. */
export function formsFilterSignature(state: FormsListState): string {
  return JSON.stringify([state.scope, state.group, state.tag, state.status, state.usedBy, state.problems, state.q.trim()]);
}

function currentQuery(): URLSearchParams {
  return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

export function useFormsListState(): [FormsListState, (patch: Partial<FormsListState>) => void] {
  const searchParams = useSearchParams();
  const searchString = searchParams?.toString() ?? null;
  const [state, setState] = React.useState<FormsListState>(() =>
    readFormsState(searchString !== null ? new URLSearchParams(searchString) : currentQuery()),
  );

  React.useEffect(() => {
    if (searchString === null) return;
    const fromUrl = readFormsState(new URLSearchParams(searchString));
    setState((previous) => (JSON.stringify(previous) === JSON.stringify(fromUrl) ? previous : fromUrl));
  }, [searchString]);

  const stateRef = React.useRef(state);
  stateRef.current = state;

  const update = React.useCallback((patch: Partial<FormsListState>) => {
    const previous = stateRef.current;
    const resetsPage = Object.keys(patch).some((key) => key !== "page");
    const next = { ...previous, ...patch, ...(resetsPage && patch.page === undefined ? { page: 1 } : {}) };
    stateRef.current = next;
    setState(next);
    if (typeof window !== "undefined") {
      const query = writeFormsState(currentQuery(), next).toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  return [state, update];
}

function errorOf(body: unknown, fallback: string): string {
  return body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
    ? (body as { error: string }).error
    : fallback;
}

function isPayload(body: unknown): body is FormLibraryPayload {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as FormLibraryPayload).rows) &&
    typeof (body as FormLibraryPayload).total === "number";
}

export type FormsListData = { payload: FormLibraryPayload | null; loading: boolean; error: string | null; reload: () => void };

export function useFormsListData(state: FormsListState): FormsListData {
  const query = formsApiQuery(state);
  const [loaded, setLoaded] = React.useState<{ query: string; payload: FormLibraryPayload } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<{ query: string; message: string } | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/admin/form-templates/library?${query}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !isPayload(body)) {
          setError({ query, message: errorOf(body, "The form list could not be loaded.") });
          return;
        }
        setLoaded({ query, payload: body });
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError({ query, message: cause instanceof Error && cause.message ? cause.message : "The form list could not be loaded." });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [query, reloadToken]);

  const reload = React.useCallback(() => setReloadToken((token) => token + 1), []);
  // Rows are shown only for the query that produced them; a reload of the same
  // query keeps them visible (marked busy) and a failed reload shows them stale.
  return { payload: loaded?.query === query ? loaded.payload : null, loading, error: error?.query === query ? error.message : null, reload };
}

export type GroupsData = { groups: FormGroupSummary[]; error: string | null; reload: () => void };

export function useFormGroups(): GroupsData {
  const [groups, setGroups] = React.useState<FormGroupSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/form-templates/groups", { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as { groups?: FormGroupSummary[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body?.groups)) throw new Error(body?.error ?? "Groups could not be loaded.");
        setGroups(body.groups);
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Groups could not be loaded.");
      }
    })();
    return () => controller.abort();
  }, [token]);
  return { groups, error, reload: React.useCallback(() => setToken((t) => t + 1), []) };
}
