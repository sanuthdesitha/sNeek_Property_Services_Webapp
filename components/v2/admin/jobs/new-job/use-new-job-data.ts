"use client";

/**
 * Reads for the New job page. Every read is cancelled when its question
 * changes and checked again after the response is parsed, so a late answer
 * for an earlier property or date never fills the page. A changed SCOPE
 * (property, job type) clears the old answer; a changed detail (times) keeps
 * it on screen, marked stale, until the new answer arrives.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewJobDayCheck, NewJobOptions, NewJobPropertyFacts } from "@/lib/jobs/new-job/types";

export type ReadStatus = "idle" | "loading" | "ready" | "error";

export type ReadState<T> = {
  status: ReadStatus;
  data: T | null;
  error: string | null;
  /** True while a refresh for the same scope is running over older data. */
  stale: boolean;
  reload: () => void;
};

async function readJson<T>(url: string, signal: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string" ? (body as { error: string }).error : "It could not be read.";
    return { ok: false, error: message };
  }
  return { ok: true, data: body as T };
}

export function useAbortableRead<T>(url: string | null, scopeKey: string, delayMs = 0): ReadState<T> {
  const [state, setState] = useState<Omit<ReadState<T>, "reload">>({ status: "idle", data: null, error: null, stale: false });
  const [nonce, setNonce] = useState(0);
  const scopeRef = useRef(scopeKey);

  useEffect(() => {
    const scopeChanged = scopeRef.current !== scopeKey;
    scopeRef.current = scopeKey;
    if (!url) {
      setState({ status: "idle", data: null, error: null, stale: false });
      return;
    }
    setState((previous) =>
      scopeChanged || !previous.data
        ? { status: "loading", data: null, error: null, stale: false }
        : { status: "loading", data: previous.data, error: null, stale: true },
    );
    const controller = new AbortController();
    const timer = setTimeout(() => {
      readJson<T>(url, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          if (result.ok) setState({ status: "ready", data: result.data, error: null, stale: false });
          else setState((previous) => ({ status: "error", data: previous.data, error: result.error, stale: Boolean(previous.data) }));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
          setState((previous) => ({ status: "error", data: previous.data, error: "The connection failed. Try again.", stale: Boolean(previous.data) }));
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, scopeKey, delayMs, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}

export function useNewJobOptions(): ReadState<NewJobOptions> {
  return useAbortableRead<NewJobOptions>("/api/admin/jobs/new-job/options", "options");
}

export function usePropertyFacts(propertyId: string, jobType: string): ReadState<NewJobPropertyFacts> {
  const url = propertyId
    ? `/api/admin/jobs/new-job/property?propertyId=${encodeURIComponent(propertyId)}&jobType=${encodeURIComponent(jobType)}`
    : null;
  return useAbortableRead<NewJobPropertyFacts>(url, `${propertyId}|${jobType}`);
}

export type DayCheckQuery = {
  propertyId: string;
  jobType: string;
  dayKeys: string[];
  startTime: string;
  dueTime: string;
  endTime: string;
  estimatedHours: string;
  suggest: boolean;
};

export function dayCheckUrl(query: DayCheckQuery | null): string | null {
  if (!query || !query.propertyId || query.dayKeys.length === 0) return null;
  const params = new URLSearchParams({ propertyId: query.propertyId, jobType: query.jobType, dates: query.dayKeys.join(",") });
  if (/^\d{2}:\d{2}$/.test(query.startTime)) params.set("startTime", query.startTime);
  if (/^\d{2}:\d{2}$/.test(query.dueTime)) params.set("dueTime", query.dueTime);
  if (/^\d{2}:\d{2}$/.test(query.endTime)) params.set("endTime", query.endTime);
  if (Number(query.estimatedHours) > 0) params.set("estimatedHours", query.estimatedHours);
  if (query.suggest) params.set("suggest", "1");
  return `/api/admin/jobs/new-job/day?${params.toString()}`;
}

export function useDayCheck(query: DayCheckQuery | null): ReadState<NewJobDayCheck> {
  const url = dayCheckUrl(query);
  return useAbortableRead<NewJobDayCheck>(url, query ? `${query.propertyId}|${query.jobType}` : "none", 250);
}
