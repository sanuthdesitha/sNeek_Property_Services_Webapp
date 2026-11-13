"use client";

/**
 * The existing week feed (GET /api/laundry/week) for a date range, shared by the
 * Completed history and By property, so the two never load the same window
 * twice. Loads only while one of them is showing (`enabled`); no polling.
 */
import * as React from "react";
import { sydneyDayStart } from "@/lib/time/sydney-range";
import type { LaundryTaskDTO } from "./laundry-shared";

export type LaundryFeed = {
  tasks: LaundryTaskDTO[];
  status: "idle" | "loading" | "success" | "error";
  error: string;
  reload: () => void;
};

export function feedDays(startKey: string, endKey: string): number {
  return Math.round((Date.parse(endKey) - Date.parse(startKey)) / 86_400_000) + 1;
}

export function useLaundryFeed(range: { start: string; end: string }, enabled: boolean): LaundryFeed {
  const [tasks, setTasks] = React.useState<LaundryTaskDTO[]>([]);
  const [status, setStatus] = React.useState<LaundryFeed["status"]>("idle");
  const [error, setError] = React.useState("");
  const [nonce, setNonce] = React.useState(0);
  const loadedKey = React.useRef<string | null>(null);
  const key = `${range.start}|${range.end}|${nonce}`;

  React.useEffect(() => {
    if (!enabled || loadedKey.current === key) return;
    const days = feedDays(range.start, range.end);
    if (!Number.isFinite(days) || days < 1 || days > 366) {
      setStatus("error");
      setError("Choose a date range of 1–366 days.");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/laundry/week?start=${sydneyDayStart(range.start).toISOString()}&days=${days}&includeVoided=1`, {
          cache: "no-store",
          signal: controller.signal,
          headers: { "x-progress-toast": "off" },
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body)) throw new Error((body as { error?: string } | null)?.error || "Could not load laundry runs.");
        loadedKey.current = key;
        setTasks(body as LaundryTaskDTO[]);
        setStatus("success");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load laundry runs.");
        setStatus("error");
      }
    })();
    return () => controller.abort();
  }, [enabled, key, range.start, range.end]);

  return { tasks, status, error, reload: () => setNonce((n) => n + 1) };
}
