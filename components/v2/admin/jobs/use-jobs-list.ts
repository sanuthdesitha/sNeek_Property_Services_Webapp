"use client";

/**
 * Loads the Jobs list for the current query: one page of rows, the real total
 * and the view-tab counts. Keeps the behaviour the page has relied on:
 * - typed search coalesces into one request (300 ms), restored URLs load at once;
 * - a 15 s refresh plus focus/visibility refresh, never overlapping and never
 *   blanking good rows: a failed background read keeps the last rows and says so;
 * - obsolete reads are aborted, and a response is checked against the latest
 *   query after parsing, so a late answer never fills a different filter.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { JobsViewCounts } from "@/lib/jobs/view-presets";
import {
  JOBS_PAGE_SIZE,
  jobsLoadFailureMessage,
  jobsResponseSchema,
  validPage,
  type JobListRow,
  type JobsPagination,
} from "./jobs-query";

export type JobsListStatus = "loading" | "success" | "error";

export type JobsListData = {
  jobs: JobListRow[];
  pagination: JobsPagination;
  counts: JobsViewCounts | null;
  status: JobsListStatus;
  error: string;
  /** A background refresh failed; rows are the last good read. */
  refreshFailed: boolean;
  loadedAt: Date | null;
  reload: () => void;
};

const EMPTY_PAGE: JobsPagination = { page: 1, limit: JOBS_PAGE_SIZE, totalCount: 0, totalPages: 1, hasMore: false };
const REFRESH_MS = 15_000;

export function useJobsList(query: string, ready: boolean): JobsListData {
  const [jobs, setJobs] = useState<JobListRow[]>([]);
  const [pagination, setPagination] = useState<JobsPagination>(EMPTY_PAGE);
  const [counts, setCounts] = useState<JobsViewCounts | null>(null);
  const [result, setResult] = useState<{ status: JobsListStatus; query: string; error: string }>({ status: "loading", query: "", error: "" });
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const latestQuery = useRef(query);
  latestQuery.current = query;
  const requestId = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const requestedSearch = useRef<string | null>(null);

  const load = useCallback(async (background: boolean) => {
    if (background && inFlight.current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const current = latestQuery.current;
    requestedSearch.current = new URLSearchParams(current).get("search") ?? "";
    const id = ++requestId.current;
    if (!background) setResult({ status: "loading", query: current, error: "" });
    let failure = "Could not load jobs. Check your connection and retry.";
    const obsolete = () => controller.signal.aborted || id !== requestId.current || current !== latestQuery.current;
    try {
      const response = await fetch(`/api/jobs?${current}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        failure = jobsLoadFailureMessage(response.status);
        throw new Error("Jobs request failed");
      }
      failure = "Jobs returned an unexpected response. Please retry.";
      const body: unknown = await response.json();
      if (obsolete()) return;
      const data = jobsResponseSchema.parse(body);
      if (!validPage(data, Number(new URLSearchParams(current).get("page")))) throw new Error("Invalid jobs pagination.");
      if (obsolete()) return;
      setRefreshFailed(false);
      setJobs(data.jobs);
      setPagination(data.pagination);
      setCounts(data.counts ?? null);
      setLoadedAt(new Date());
      setResult({ status: "success", query: current, error: "" });
    } catch {
      if (obsolete()) return;
      if (background) setRefreshFailed(true);
      else setResult({ status: "error", query: current, error: failure });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const nextSearch = new URLSearchParams(query).get("search") ?? "";
    const delay = requestedSearch.current !== null && requestedSearch.current !== nextSearch ? 300 : 0;
    const timer = delay ? window.setTimeout(() => { void load(false); }, delay) : undefined;
    if (!delay) void load(false);
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [ready, query, load]);

  useEffect(() => {
    if (!ready) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ready, load]);

  const status: JobsListStatus = !ready || result.query !== query ? "loading" : result.status;
  return {
    jobs, pagination, counts, status, error: result.error, refreshFailed, loadedAt,
    reload: () => { void load(false); },
  };
}
