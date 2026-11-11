"use client";

/**
 * The job shown in the peek panel lives in the URL as `?open=<jobId>`, beside
 * the list's own state, so a reload or Back reopens the same job. Other query
 * values (filters, page, tab) are left exactly as they are.
 */
import { useCallback, useEffect, useState } from "react";
import { rememberCurrentView } from "@/lib/navigation/view-memory";

export const PEEK_PARAM = "open";
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function readPeekParam(search: string): string | null {
  const value = new URLSearchParams(search).get(PEEK_PARAM);
  return value && ID_PATTERN.test(value) ? value : null;
}

export function usePeekParam(): [string | null, (jobId: string | null) => void] {
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setJobId(readPeekParam(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const setOpen = useCallback((next: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (next && ID_PATTERN.test(next)) params.set(PEEK_PARAM, next);
    else params.delete(PEEK_PARAM);
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    rememberCurrentView();
    setJobId(next && ID_PATTERN.test(next) ? next : null);
  }, []);

  return [jobId, setOpen];
}
