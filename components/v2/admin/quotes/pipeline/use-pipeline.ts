"use client";

/**
 * Pipeline list state: filters, sort, page and the open row in the URL
 * (?stage= &q= &service= &page= &sort= &dir= &open=lead:<id>|quote:<id>),
 * and the server read for them, with obsolete reads aborted.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { rememberCurrentView } from "@/lib/navigation/view-memory";
import { PIPELINE_SORTS, PIPELINE_STAGES, type PipelineCounts, type PipelineRow, type PipelineSort, type PipelineStage } from "@/lib/quotes/pipeline-types";

export type PipelineState = {
  stage: PipelineStage;
  q: string;
  service: string;
  recurring: boolean;
  page: number;
  sort: PipelineSort;
  dir: "asc" | "desc";
  open: string | null;
};

const DEFAULTS: PipelineState = { stage: "open", q: "", service: "", recurring: false, page: 1, sort: "updated", dir: "desc", open: null };

export function readPipelineState(search: string): PipelineState {
  const params = new URLSearchParams(search);
  const stage = params.get("stage");
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  const open = params.get("open");
  return {
    stage: (PIPELINE_STAGES as readonly string[]).includes(stage ?? "") ? (stage as PipelineStage) : DEFAULTS.stage,
    q: params.get("q") ?? "",
    service: params.get("service") ?? "",
    recurring: params.get("recurring") === "1",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    sort: (PIPELINE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as PipelineSort) : DEFAULTS.sort,
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    open: open && /^(lead|quote):[A-Za-z0-9_-]{1,64}$/.test(open) ? open : null,
  };
}

export function pipelineQuery(state: PipelineState): URLSearchParams {
  const params = new URLSearchParams({ stage: state.stage, page: String(state.page), pageSize: "25", sort: state.sort, dir: state.dir });
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.service) params.set("service", state.service);
  if (state.recurring) params.set("recurring", "1");
  return params;
}

export type PipelinePageData = { rows: PipelineRow[]; total: number; counts: PipelineCounts };

export function usePipeline() {
  const [state, setState] = useState<PipelineState>(DEFAULTS);
  const [data, setData] = useState<PipelinePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const sync = () => setState(readPipelineState(window.location.search));
    sync();
    setReady(true);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: Partial<PipelineState>) => {
    const next = { ...stateRef.current, ...patch };
    const params = new URLSearchParams(window.location.search);
    (Object.keys(DEFAULTS) as Array<keyof PipelineState>).forEach((key) => {
      const value = next[key];
      if (value === DEFAULTS[key] || value === "" || value == null) params.delete(key);
      else params.set(key, typeof value === "boolean" ? "1" : String(value));
    });
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    rememberCurrentView();
    setState(next);
  }, []);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/quotes/pipeline?${pipelineQuery(stateRef.current).toString()}`, { cache: "no-store", signal: current.signal });
      const body = (await res.json().catch(() => null)) as (PipelinePageData & { error?: string }) | null;
      if (current.signal.aborted) return;
      if (!res.ok || !body) {
        setError(body?.error ?? "Could not load quotes.");
        return;
      }
      setData({ rows: body.rows, total: body.total, counts: body.counts });
      setError(null);
    } catch {
      if (!current.signal.aborted) setError("Could not load quotes.");
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, []);

  const key = `${state.stage}|${state.q}|${state.service}|${state.recurring}|${state.page}|${state.sort}|${state.dir}`;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void load(), state.q ? 250 : 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, load]);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, update, data, loading, error, reload: load };
}
