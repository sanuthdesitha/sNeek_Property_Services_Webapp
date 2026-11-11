"use client";

/**
 * Reads `GET /api/admin/calendar` for the visible range.
 *
 * - A new range or filter aborts the previous read and clears the old data:
 *   rows from another range are never shown as if they answered this one.
 * - Background refresh every 60 s while the tab is visible, and on focus or
 *   when the tab becomes visible again; background reads never overlap, are
 *   aborted by a newer read, and are checked against the current query after
 *   parsing.
 * - A failed first read is an error (never an empty calendar); a failed
 *   background read keeps the last good data and marks it stale.
 * - Jobs whose move is being checked or saved (`pendingIds`) keep their
 *   current chip when a refresh lands (`mergePreservingPending`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mergePreservingPending } from "@/lib/calendar/merge";
import { calendarResponseSchema, type CalendarResponse } from "@/lib/calendar/types";

export const CALENDAR_POLL_MS = 60_000;

export type CalendarDataStatus = "idle" | "loading" | "success" | "error";

export type CalendarData = {
  status: CalendarDataStatus;
  data: CalendarResponse | null;
  error: string;
  /** The last background refresh failed; `data` is the last good read. */
  stale: boolean;
  loadedAt: Date | null;
  reload: () => void;
};

async function readCalendar(query: string, signal: AbortSignal): Promise<CalendarResponse> {
  const response = await fetch(`/api/admin/calendar?${query}`, { cache: "no-store", signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
    if (response.status === 403) throw new Error("This account cannot view the calendar.");
    throw new Error(message || `The calendar could not be loaded (${response.status}).`);
  }
  const parsed = calendarResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("The calendar returned an unexpected response.");
  return parsed.data;
}

export function useCalendarData(query: string | null, pendingIds: ReadonlySet<string>): CalendarData {
  const [status, setStatus] = useState<CalendarDataStatus>("idle");
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const queryRef = useRef(query);
  const controllerRef = useRef<AbortController | null>(null);
  const backgroundInFlight = useRef(false);
  const hasDataRef = useRef(false);
  const pendingRef = useRef(pendingIds);
  pendingRef.current = pendingIds;
  queryRef.current = query;

  const run = useCallback((mode: "foreground" | "background") => {
    const forQuery = queryRef.current;
    if (!forQuery) return;
    // A background read only refreshes data already shown; it never races the first read.
    if (mode === "background" && (backgroundInFlight.current || !hasDataRef.current)) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    if (mode === "foreground") {
      setStatus("loading");
      setData(null);
      hasDataRef.current = false;
      setError("");
      setStale(false);
    } else {
      backgroundInFlight.current = true;
    }
    readCalendar(forQuery, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || queryRef.current !== forQuery) return;
        setData((previous) => mergePreservingPending(previous, next, pendingRef.current));
        hasDataRef.current = true;
        setStatus("success");
        setStale(false);
        setError("");
        setLoadedAt(new Date());
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || queryRef.current !== forQuery) return;
        const message = cause instanceof Error ? cause.message : "The calendar could not be loaded.";
        if (mode === "background") {
          setStale(true);
          setError(message);
        } else {
          setStatus("error");
          setError(message);
        }
      })
      .finally(() => {
        if (mode === "background") backgroundInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    if (!query) return;
    run("foreground");
    return () => controllerRef.current?.abort();
  }, [query, run]);

  useEffect(() => {
    if (!query) return;
    const refresh = () => {
      if (document.visibilityState === "visible") run("background");
    };
    const timer = window.setInterval(refresh, CALENDAR_POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [query, run]);

  const reload = useCallback(() => {
    backgroundInFlight.current = false;
    run(hasDataRef.current ? "background" : "foreground");
  }, [run]);

  return { status, data, error, stale, loadedAt, reload };
}
