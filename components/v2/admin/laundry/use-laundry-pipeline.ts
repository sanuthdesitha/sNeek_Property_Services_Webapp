"use client";

/**
 * Loads the Pipeline for a day and filter set from GET /api/admin/laundry/pipeline.
 *
 * - Obsolete reads are aborted and a response is checked against the current
 *   query after parsing.
 * - One read whenever the day or filters change. Polling (30 s and on focus)
 *   runs only while `live` is true — the Pipeline tab is showing — and pauses while a save is in flight, so a refresh never
 *   overwrites a card mid-save. A failed background read keeps the last lanes.
 */
import * as React from "react";
import type { PipelineException, PipelineLane, PipelineSettings } from "@/lib/laundry/pipeline";
import type { LaundryTaskDTO } from "./laundry-shared";
import type { SupplierTeamSummary } from "@/lib/laundry/nudge-rules";

export type PipelineCardDTO = LaundryTaskDTO & {
  updatedAt: string;
  lane: PipelineLane;
  carriedIn: boolean;
  exceptions: PipelineException[];
  readiness: boolean | null;
  bagCount: number | null;
  driver: { driverId: string; driverName: string; stop: number; kind: "PICKUP" | "DROP" } | null;
  dayOf: { day: number; planned: number } | null;
  nextGuest: { checkinAt: string | null; name: string | null } | null;
  cleaners: string[];
  /** The run's laundry partner team who can be asked (names only); null when the run has no supplier. */
  supplierTeam: SupplierTeamSummary;
};

export type PipelineData = {
  date: string;
  today: string;
  lanes: Record<PipelineLane, PipelineCardDTO[]>;
  counts: Record<PipelineLane, number>;
  summary: { pickups: number; drops: number; exceptions: number };
  tiles: { runsToday: number; inTransit: number; deliveredToday: number };
  drivers: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  approvalsFlagged: number;
  settings: PipelineSettings;
  truncated: boolean;
  generatedAt: string;
};

export type PipelineQuery = { date: string; q: string; supplierId: string; driverId: string };

export const PIPELINE_REFRESH_MS = 30_000;

export function pipelineQueryString(query: PipelineQuery): string {
  const params = new URLSearchParams({ date: query.date });
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.supplierId) params.set("supplierId", query.supplierId);
  if (query.driverId) params.set("driverId", query.driverId);
  return params.toString();
}

function isPipelineData(value: unknown): value is PipelineData {
  const data = value as Partial<PipelineData> | null;
  return Boolean(data && typeof data.date === "string" && data.lanes && data.counts && data.summary && data.tiles);
}

export type PipelineState = {
  data: PipelineData | null;
  status: "loading" | "success" | "error";
  error: string;
  refreshFailed: boolean;
  reload: () => void;
};

export function useLaundryPipeline(query: PipelineQuery, options: { live: boolean; paused: boolean }): PipelineState {
  const queryString = pipelineQueryString(query);
  const [data, setData] = React.useState<PipelineData | null>(null);
  const [result, setResult] = React.useState<{ status: PipelineState["status"]; query: string; error: string }>({ status: "loading", query: "", error: "" });
  const [refreshFailed, setRefreshFailed] = React.useState(false);
  const latest = React.useRef(queryString);
  latest.current = queryString;
  const pausedRef = React.useRef(options.paused);
  pausedRef.current = options.paused;
  const inFlight = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async (background: boolean) => {
    if (background && (inFlight.current || pausedRef.current)) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const current = latest.current;
    const obsolete = () => controller.signal.aborted || current !== latest.current;
    if (!background) setResult({ status: "loading", query: current, error: "" });
    try {
      const response = await fetch(`/api/admin/laundry/pipeline?${current}`, { cache: "no-store", signal: controller.signal, headers: { "x-progress-toast": "off" } });
      const body: unknown = await response.json().catch(() => null);
      if (obsolete()) return;
      if (!response.ok) throw new Error((body as { error?: string } | null)?.error || "Could not load the pipeline.");
      if (!isPipelineData(body)) throw new Error("The pipeline returned an unexpected response.");
      // A save that started while this read was out wins: drop the stale answer.
      if (background && pausedRef.current) return;
      setData(body);
      setRefreshFailed(false);
      setResult({ status: "success", query: current, error: "" });
    } catch (cause) {
      if (obsolete()) return;
      if (background) setRefreshFailed(true);
      else setResult({ status: "error", query: current, error: cause instanceof Error ? cause.message : "Could not load the pipeline." });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  // One read per day/filter change on any tab (the header's day summary and
  // the stat tiles come from it); repeated polling only on live tabs, below.
  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(false), query.q ? 300 : 0);
    return () => {
      window.clearTimeout(timer);
      inFlight.current?.abort();
      inFlight.current = null;
    };
    // query.q only decides the debounce; the string carries the query itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString, load]);

  React.useEffect(() => {
    if (!options.live) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    const timer = window.setInterval(refresh, PIPELINE_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [options.live, load]);

  const status = result.query !== queryString ? "loading" : result.status;
  return { data, status, error: result.error, refreshFailed, reload: () => void load(false) };
}
