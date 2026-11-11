"use client";

/**
 * One Command section's data: the server's first render, then its own
 * refresh from GET /api/admin/command/<section> every `intervalMs` while the
 * page is visible, on focus, and on demand. Each section refreshes alone, so
 * the page never re-runs every query to update one figure.
 *
 * An obsolete read is aborted, and a response is applied only if it is still
 * the latest request after parsing. A failed refresh keeps the last good data
 * and marks it stale; a failed first load is an error with nothing shown as zero.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommandSectionKey } from "@/lib/dashboard/command-types";

export type SectionState<T> = {
  data: T | null;
  status: "loading" | "ready" | "error";
  /** True when `data` is from an earlier read because the latest refresh failed. */
  stale: boolean;
  error: string;
  refreshedAt: Date | null;
  reload: () => void;
};

export const COMMAND_REFRESH_MS = 30_000;

async function readSection<T>(section: CommandSectionKey, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin/command/${section}`, { cache: "no-store", signal, headers: { "x-progress-toast": "off" } });
  if (response.status === 403) throw new Error("This account cannot view this section.");
  if (response.status === 401) throw new Error("Your session has ended. Sign in again.");
  if (!response.ok) throw new Error("This section could not be loaded.");
  return (await response.json()) as T;
}

export function useCommandSection<T>(section: CommandSectionKey, initial: T | null, intervalMs = COMMAND_REFRESH_MS): SectionState<T> {
  const [data, setData] = useState<T | null>(initial);
  const [status, setStatus] = useState<SectionState<T>["status"]>(initial ? "ready" : "loading");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(initial ? new Date() : null);
  const latest = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const hasData = useRef(initial !== null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const request = ++latest.current;
    if (!hasData.current) setStatus("loading");
    try {
      const next = await readSection<T>(section, current.signal);
      if (current.signal.aborted || request !== latest.current) return;
      hasData.current = true;
      setData(next);
      setStatus("ready");
      setStale(false);
      setError("");
      setRefreshedAt(new Date());
    } catch (err) {
      if (current.signal.aborted || request !== latest.current) return;
      setError(err instanceof Error ? err.message : "This section could not be loaded.");
      if (hasData.current) setStale(true);
      else setStatus("error");
    }
  }, [section]);

  useEffect(() => {
    if (initial === null) void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      controller.current?.abort();
    };
    // `initial` only seeds the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs]);

  return { data, status, stale, error, refreshedAt, reload: () => void load() };
}
