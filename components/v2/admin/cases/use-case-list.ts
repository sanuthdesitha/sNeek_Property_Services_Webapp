"use client";

/**
 * Loads one page of case summaries plus real queue and type counts.
 *
 * - Obsolete reads are aborted; a response is checked again after parsing so a
 *   late answer never fills a different queue or filter.
 * - A 30 s refresh plus focus refresh run in the background: they never blank
 *   good rows, and a failed background read keeps the rows and says so.
 * - Mutations patch one row (`replaceRow`) and refresh only the counts.
 */
import * as React from "react";
import { readJson, type AssigneeOption, type CaseQueueCounts, type CaseSummary, type CaseTypeCounts, type CaseViewer } from "./case-types";

export type CaseListStatus = "loading" | "success" | "error";

type SummaryBody = {
  rows: CaseSummary[];
  total: number;
  page: number;
  pageCount: number;
  counts: CaseQueueCounts;
  typeCounts: CaseTypeCounts;
  assignees: AssigneeOption[];
  viewer: CaseViewer;
};

export type CaseListData = {
  rows: CaseSummary[];
  total: number;
  pageCount: number;
  counts: CaseQueueCounts | null;
  typeCounts: CaseTypeCounts | null;
  assignees: AssigneeOption[];
  viewer: CaseViewer | null;
  status: CaseListStatus;
  error: string;
  refreshFailed: boolean;
  reload: () => void;
  replaceRow: (row: CaseSummary) => void;
  removeRow: (id: string) => void;
  refreshCounts: () => void;
};

const REFRESH_MS = 30_000;

function isSummaryBody(value: unknown): value is SummaryBody {
  const body = value as Partial<SummaryBody> | null;
  return Boolean(body && Array.isArray(body.rows) && typeof body.total === "number" && body.counts && body.typeCounts);
}

export function useCaseList(query: string): CaseListData {
  const [rows, setRows] = React.useState<CaseSummary[]>([]);
  const [total, setTotal] = React.useState(0);
  const [pageCount, setPageCount] = React.useState(1);
  const [counts, setCounts] = React.useState<CaseQueueCounts | null>(null);
  const [typeCounts, setTypeCounts] = React.useState<CaseTypeCounts | null>(null);
  const [assignees, setAssignees] = React.useState<AssigneeOption[]>([]);
  const [viewer, setViewer] = React.useState<CaseViewer | null>(null);
  const [result, setResult] = React.useState<{ status: CaseListStatus; query: string; error: string }>({ status: "loading", query: "", error: "" });
  const [refreshFailed, setRefreshFailed] = React.useState(false);

  const latestQuery = React.useRef(query);
  latestQuery.current = query;
  const inFlight = React.useRef<AbortController | null>(null);
  const requestId = React.useRef(0);

  const load = React.useCallback(async (background: boolean) => {
    if (background && inFlight.current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const current = latestQuery.current;
    const id = ++requestId.current;
    const obsolete = () => controller.signal.aborted || id !== requestId.current || current !== latestQuery.current;
    if (!background) setResult({ status: "loading", query: current, error: "" });
    try {
      const response = await fetch(`/api/admin/cases?shape=summary&${current}`, { cache: "no-store", signal: controller.signal });
      const body = await readJson<unknown>(response);
      if (obsolete()) return;
      if (!response.ok) throw new Error((body as { error?: string }).error || "Could not load cases.");
      if (!isSummaryBody(body)) throw new Error("Cases returned an unexpected response.");
      setRows(body.rows);
      setTotal(body.total);
      setPageCount(body.pageCount);
      setCounts(body.counts);
      setTypeCounts(body.typeCounts);
      setAssignees(body.assignees);
      setViewer(body.viewer);
      setRefreshFailed(false);
      setResult({ status: "success", query: current, error: "" });
    } catch (error) {
      if (obsolete()) return;
      if (background) setRefreshFailed(true);
      else setResult({ status: "error", query: current, error: error instanceof Error ? error.message : "Could not load cases." });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  const countsController = React.useRef<AbortController | null>(null);
  const refreshCounts = React.useCallback(async () => {
    countsController.current?.abort();
    const controller = new AbortController();
    countsController.current = controller;
    const current = latestQuery.current;
    try {
      const response = await fetch(`/api/admin/cases?shape=summary&countsOnly=1&${current}`, { cache: "no-store", signal: controller.signal });
      const body = await readJson<{ counts?: CaseQueueCounts; typeCounts?: CaseTypeCounts }>(response);
      if (controller.signal.aborted || current !== latestQuery.current || !response.ok || !body.counts || !body.typeCounts) return;
      setCounts(body.counts);
      setTypeCounts(body.typeCounts);
    } catch {
      // Counts stay as they were; the next refresh corrects them.
    }
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [query, load]);

  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      countsController.current?.abort();
    };
  }, [load]);

  const replaceRow = React.useCallback((row: CaseSummary) => {
    setRows((current) => current.map((item) => (item.id === row.id ? row : item)));
  }, []);
  const removeRow = React.useCallback((id: string) => {
    setRows((current) => current.filter((item) => item.id !== id));
    setTotal((current) => Math.max(0, current - 1));
  }, []);

  const status: CaseListStatus = result.query !== query ? "loading" : result.status;
  return {
    rows, total, pageCount, counts, typeCounts, assignees, viewer, status, error: result.error, refreshFailed,
    reload: () => void load(false),
    replaceRow,
    removeRow,
    refreshCounts: () => void refreshCounts(),
  };
}
