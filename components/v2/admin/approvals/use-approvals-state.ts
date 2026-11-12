"use client";

/**
 * Approvals page state: the waiting requests (one read of
 * /api/admin/all-approvals, obsolete reads aborted) and the URL values the page
 * keeps (?tab=decided, ?queue=<key>|all, ?open=<request id>), so a reload or a
 * shared link reopens the same queue and request. Other query values are left
 * as they are.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { rememberCurrentView } from "@/lib/navigation/view-memory";
import { isApprovalsQueueKey, type ApprovalsQueueKey } from "@/lib/admin/approvals/queues";
import type { AllApprovalsResponse } from "@/lib/admin/approvals/rows";

export type ApprovalsTab = "waiting" | "decided";
export type QueueSelection = ApprovalsQueueKey | "all";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export type ApprovalsUrlState = { tab: ApprovalsTab; queue: QueueSelection | null; open: string | null };

export function readApprovalsUrl(search: string): ApprovalsUrlState {
  const params = new URLSearchParams(search);
  const rawQueue = params.get("queue");
  const rawOpen = params.get("open");
  return {
    tab: params.get("tab") === "decided" || params.get("tab") === "history" ? "decided" : "waiting",
    queue: rawQueue === "all" ? "all" : isApprovalsQueueKey(rawQueue) ? rawQueue : null,
    open: rawOpen && ID_PATTERN.test(rawOpen) ? rawOpen : null,
  };
}

function writeUrl(next: ApprovalsUrlState) {
  const params = new URLSearchParams(window.location.search);
  if (next.tab === "decided") params.set("tab", "decided");
  else params.delete("tab");
  if (next.queue) params.set("queue", next.queue);
  else params.delete("queue");
  if (next.open) params.set("open", next.open);
  else params.delete("open");
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  rememberCurrentView();
}

export function useApprovalsUrl(): [ApprovalsUrlState, (patch: Partial<ApprovalsUrlState>) => void, boolean] {
  const [state, setState] = useState<ApprovalsUrlState>({ tab: "waiting", queue: null, open: null });
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const sync = () => setState(readApprovalsUrl(window.location.search));
    sync();
    setReady(true);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const update = useCallback((patch: Partial<ApprovalsUrlState>) => {
    const next = { ...stateRef.current, ...patch };
    writeUrl(next);
    setState(next);
  }, []);

  return [state, update, ready];
}

export type ApprovalsData = {
  data: AllApprovalsResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useApprovalsData(): ApprovalsData {
  const [data, setData] = useState<AllApprovalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/all-approvals", { cache: "no-store", signal: current.signal });
      const body = (await res.json().catch(() => null)) as (AllApprovalsResponse & { error?: string }) | null;
      if (current.signal.aborted) return;
      if (!res.ok || !body) {
        setError(body?.error === "FORBIDDEN" ? "You do not have access to approvals." : "Could not load the waiting requests.");
        return;
      }
      setData(body);
      setError(null);
    } catch (err) {
      if (current.signal.aborted) return;
      setError(err instanceof Error && err.name !== "AbortError" ? "Could not load the waiting requests." : null);
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => controller.current?.abort();
  }, [reload]);

  return { data, loading, error, reload };
}
