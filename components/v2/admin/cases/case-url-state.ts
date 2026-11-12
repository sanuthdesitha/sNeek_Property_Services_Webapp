"use client";

/**
 * The inbox's list state: queue, filters, sort and page. Back returns the
 * inbox as it was (restorable view memory, as before); an explicit link wins:
 * `?queue=` (or the old `?view=`), `?jobId=` (Live ops links), `?reportId=`
 * and `?q=` are applied on arrival. The open case lives in `?open=`.
 */
import * as React from "react";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { parseCaseQueue } from "@/lib/cases/queues";
import { EMPTY_FILTERS, type CaseListFilters, type CaseQueue, type CaseSort } from "./case-types";

export const CASE_PAGE_SIZE_CLIENT = 50;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export type CaseListState = {
  queue: CaseQueue;
  filters: CaseListFilters;
  sort: CaseSort;
  dir: "asc" | "desc";
  page: number;
};

export const DEFAULT_CASE_STATE: CaseListState = { queue: "open", filters: EMPTY_FILTERS, sort: "sla", dir: "asc", page: 1 };

/** Applies an arriving link's parameters over the remembered state. */
export function stateFromLink(search: string, remembered: CaseListState): CaseListState {
  const params = new URLSearchParams(search);
  const queue = params.get("queue") ?? params.get("view");
  const jobId = params.get("jobId");
  const reportId = params.get("reportId");
  const q = params.get("q");
  const linked = Boolean(queue || jobId || reportId || q);
  if (!linked) return remembered;
  return {
    ...remembered,
    // A link to one job's or report's cases shows all of them, not one queue's.
    queue: queue ? parseCaseQueue(queue, remembered.queue) : jobId || reportId ? "all" : remembered.queue,
    filters: {
      ...EMPTY_FILTERS,
      q: q?.slice(0, 200) ?? "",
      jobId: jobId && ID.test(jobId) ? jobId : "",
      reportId: reportId && ID.test(reportId) ? reportId : "",
    },
    page: 1,
  };
}

/** Query string for the summary list (without `shape`). */
export function listQueryString(state: CaseListState, debouncedQ: string): string {
  const params = new URLSearchParams({
    queue: state.queue,
    sort: state.sort,
    dir: state.dir,
    page: String(state.page),
    pageSize: String(CASE_PAGE_SIZE_CLIENT),
  });
  const { filters } = state;
  if (debouncedQ.trim()) params.set("q", debouncedQ.trim());
  if (filters.caseType) params.set("caseType", filters.caseType);
  if (filters.status) params.set("status", filters.status);
  if (filters.assigneeUserId) params.set("assigneeUserId", filters.assigneeUserId);
  if (filters.jobId && ID.test(filters.jobId)) params.set("jobId", filters.jobId);
  if (filters.reportId && ID.test(filters.reportId)) params.set("reportId", filters.reportId);
  return params.toString();
}

export function useCaseListState(): [CaseListState, (patch: Partial<CaseListState>) => void] {
  const [state, setState] = useRestorableState<CaseListState>("cases:list", DEFAULT_CASE_STATE);
  const arrived = React.useRef(false);

  React.useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    setState((remembered) => stateFromLink(window.location.search, remembered));
    // Only on arrival; later changes are the person's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = React.useCallback(
    (patch: Partial<CaseListState>) => {
      // Any change other than paging returns to the first page.
      setState((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
    },
    [setState],
  );
  return [state, update];
}
