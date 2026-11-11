"use client";

/**
 * Board lanes for the current filters from `/api/admin/jobs/board`: real lane
 * totals over every matching job, with each lane's first rows. Refreshes like
 * the list (15 s, focus, visibility), aborts obsolete reads and keeps the last
 * lanes with a stale notice when a background read fails.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { jobListRowSchema, jobsSortRefusal } from "./jobs-query";

const laneSchema = z.object({
  id: z.enum(["unassigned", "scheduled", "inprogress", "done"]),
  label: z.string(),
  statuses: z.array(z.string()),
  count: z.number().int().nonnegative(),
  jobs: z.array(jobListRowSchema),
});
const boardSchema = z.object({ lanes: z.array(laneSchema), total: z.number().int().nonnegative(), laneLimit: z.number().int().positive() });
export type JobsBoard = z.infer<typeof boardSchema>;
export type JobsBoardLane = JobsBoard["lanes"][number];

export type JobsBoardData = {
  board: JobsBoard | null;
  status: "idle" | "loading" | "success" | "error";
  error: string;
  refreshFailed: boolean;
  reload: () => void;
};

export function useJobsBoard(query: string, enabled: boolean): JobsBoardData {
  const [board, setBoard] = useState<JobsBoard | null>(null);
  const [result, setResult] = useState<{ status: JobsBoardData["status"]; query: string; error: string }>({ status: "idle", query: "", error: "" });
  const [refreshFailed, setRefreshFailed] = useState(false);
  const latest = useRef(query);
  latest.current = query;
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (background: boolean) => {
    if (background && inFlight.current) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const current = latest.current;
    if (!background) setResult({ status: "loading", query: current, error: "" });
    const obsolete = () => controller.signal.aborted || current !== latest.current;
    try {
      const response = await fetch(`/api/admin/jobs/board?${current}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const refusal = response.status === 400 ? jobsSortRefusal(400, await response.json().catch(() => null)) : null;
        if (obsolete()) return;
        throw new Error(refusal ?? (response.status === 403 ? "This account cannot view the board." : `The board could not load (${response.status}).`));
      }
      const body: unknown = await response.json();
      if (obsolete()) return;
      const parsed = boardSchema.parse(body);
      if (obsolete()) return;
      setBoard(parsed);
      setRefreshFailed(false);
      setResult({ status: "success", query: current, error: "" });
    } catch (error) {
      if (obsolete()) return;
      if (background) setRefreshFailed(true);
      else setResult({ status: "error", query: current, error: error instanceof Error && !(error instanceof z.ZodError) ? error.message : "The board returned an unexpected response." });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [enabled, query, load]);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [enabled, load]);

  const status = !enabled ? "idle" : result.query !== query ? "loading" : result.status;
  // Lanes from a different filter are never shown as the answer to this one.
  return { board: status === "success" ? board : null, status, error: result.error, refreshFailed, reload: () => { void load(false); } };
}
