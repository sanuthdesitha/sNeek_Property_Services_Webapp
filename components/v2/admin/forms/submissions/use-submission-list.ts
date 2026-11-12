"use client";

/**
 * The Submissions view's URL state and its server-paged list. A newer read
 * aborts the older one and every answer is checked against the request still
 * current after parsing, so a slow response never replaces a newer list. On a
 * failure the last good page stays on screen with the error beside it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubmissionListResponse } from "@/lib/forms/submission-list";
import { PAGE_RESETTING, readSubmissionsView, submissionsApiQuery, submissionsSearch, type SubmissionsView } from "./submissions-query";

export const SUBMISSIONS_PAGE_SIZE = 25;

/** `initial` is read from the request on the server, so the first render matches. */
export function useSubmissionsView(initial: SubmissionsView): [SubmissionsView, (patch: Partial<SubmissionsView>) => void] {
  const [view, setView] = useState<SubmissionsView>(initial);
  useEffect(() => {
    const sync = () => setView(readSubmissionsView(window.location.search));
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const update = useCallback((patch: Partial<SubmissionsView>) => {
    setView((current) => {
      const resets = PAGE_RESETTING.some((key) => key in patch);
      const next = { ...current, ...patch, page: patch.page ?? (resets ? 1 : current.page) };
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${submissionsSearch(next)}${window.location.hash}`);
      return next;
    });
  }, []);
  return [view, update];
}

export type SubmissionListState = { data: SubmissionListResponse | null; loading: boolean; error: string | null; reload: () => void };

export function useSubmissionList(view: SubmissionsView): SubmissionListState {
  const [data, setData] = useState<SubmissionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const current = useRef("");
  const query = submissionsApiQuery(view, SUBMISSIONS_PAGE_SIZE);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${query}#${revision}`;
    current.current = key;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/form-submissions?${query}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (SubmissionListResponse & { error?: string }) | null;
        if (controller.signal.aborted || current.current !== key) return;
        if (!response.ok || !body || !Array.isArray(body.rows)) throw new Error(body?.error ?? `Could not load submissions (${response.status}).`);
        setData(body);
        setError(null);
      } catch (reason) {
        if (controller.signal.aborted || current.current !== key) return;
        setError(reason instanceof Error ? reason.message : "Could not load submissions.");
      } finally {
        if (!controller.signal.aborted && current.current === key) setLoading(false);
      }
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { data, loading, error, reload };
}
