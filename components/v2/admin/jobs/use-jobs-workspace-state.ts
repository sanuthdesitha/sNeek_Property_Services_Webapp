"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_JOBS_STATE, hasExplicitJobsState, jobsColumnsSchema, readJobsColumns, readJobsState, writeJobsState, type JobsSnapshot, type JobsWorkspaceState } from "@/lib/jobs/workspace-state";
export { DEFAULT_JOBS_STATE, readJobsState, writeJobsState, type JobsWorkspaceState } from "@/lib/jobs/workspace-state";

export function useJobsWorkspaceState() {
  const searchParams = useSearchParams();
  const query = searchParams?.toString() ?? "";
  const [state, setState] = useState(DEFAULT_JOBS_STATE);
  const [ready, setReady] = useState(false);
  const [columnsError, setColumnsError] = useState(false);
  const current = useRef(state);
  const defaultAllowed = useRef(true);
  const restoredQuery = useRef<string | null>(null);

  useEffect(() => {
    const restore = (navigated = false) => {
      const params = new URLSearchParams(window.location.search);
      if (navigated || (restoredQuery.current !== null && restoredQuery.current !== window.location.search)
        || hasExplicitJobsState(params)) defaultAllowed.current = false;
      restoredQuery.current = window.location.search;
      current.current = readJobsState(params);
      setColumnsError(readJobsColumns(params).error);
      setState(current.current);
      setReady(true);
    };
    restore();
    const onPopState = () => restore(true);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [query]);

  const update = useCallback((patch: Partial<JobsWorkspaceState>) => {
    defaultAllowed.current = false;
    const changesColumns = Object.prototype.hasOwnProperty.call(patch, "columns");
    if (changesColumns && !jobsColumnsSchema.safeParse(patch.columns).success) {
      setColumnsError(true);
      return;
    }
    const next = { ...current.current, ...patch };
    if ((Object.keys(patch) as (keyof JobsWorkspaceState)[]).some(
      key => key !== "page" && key !== "view" && key !== "density" && key !== "columns" && next[key] !== current.current[key]
    )) next.page = 1;
    const previousParams = new URLSearchParams(window.location.search);
    const params = writeJobsState(previousParams, next);
    // An explicit reset must not load a personal default on the next visit.
    params.set("jobsState", "1");
    current.current = readJobsState(params);
    const cleanParams = writeJobsState(params, current.current);
    // Unrelated edits must not silently turn an invalid link into a saved all-visible view.
    if (!changesColumns && readJobsColumns(previousParams).error) {
      cleanParams.delete("columns");
      previousParams.getAll("columns").forEach(value => cleanParams.append("columns", value));
    }
    setColumnsError(readJobsColumns(cleanParams).error);
    const clean = cleanParams.toString();
    // Replace this list entry so Back from a detail returns the latest view.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${clean ? `?${clean}` : ""}${window.location.hash}`);
    setState(current.current);
  }, []);

  const applyDefault = useCallback((snapshot: JobsSnapshot) => {
    if (!defaultAllowed.current || hasExplicitJobsState(new URLSearchParams(window.location.search))) return false;
    update({ ...snapshot, page: 1 });
    return true;
  }, [update]);

  return { state, ready, update, applyDefault, columnsError };
}
