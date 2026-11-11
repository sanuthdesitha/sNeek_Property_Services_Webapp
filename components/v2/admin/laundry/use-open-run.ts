"use client";

/**
 * The run shown in the side panel (`?open=<taskId>`). It is taken from the
 * cards already on screen; when a linked run is not among them, it is read once
 * from GET /api/admin/laundry/[taskId]. A late answer for a run that is no
 * longer selected is ignored.
 */
import * as React from "react";
import type { RunPanelTask } from "./laundry-run-panel";

export function useOpenRun(openId: string | null, onScreen: RunPanelTask[], nonce: number): { task: RunPanelTask | null; status: "idle" | "loading" | "error" } {
  const fromScreen = openId ? onScreen.find((task) => task.id === openId) ?? null : null;
  const [fetched, setFetched] = React.useState<RunPanelTask | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const current = React.useRef(openId);
  current.current = openId;

  React.useEffect(() => {
    setFetched(null);
    if (!openId || fromScreen) {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    void (async () => {
      try {
        const response = await fetch(`/api/admin/laundry/${encodeURIComponent(openId)}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as RunPanelTask | null;
        if (controller.signal.aborted || current.current !== openId) return;
        if (!response.ok || !body || body.id !== openId) throw new Error("not found");
        setFetched(body);
        setStatus("idle");
      } catch {
        if (!controller.signal.aborted && current.current === openId) setStatus("error");
      }
    })();
    return () => controller.abort();
    // Only refetch when the selection changes or after a save, not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, Boolean(fromScreen), nonce]);

  return { task: fromScreen ?? fetched, status };
}
