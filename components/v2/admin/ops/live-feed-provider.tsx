"use client";

/**
 * The one live data source for Live ops. A single provider owns:
 * - the position snapshot (GET /api/admin/ops/live-locations, every 15 s),
 * - the position stream (one EventSource on /live-locations/stream), and
 * - the board (GET /api/admin/ops/live-board, every 30 s and on focus).
 * The exceptions list, the on-site rows and the map all read this context,
 * so the feed is fetched once, not once per component as before.
 *
 * Each read aborts the previous one of its kind and is applied only if it is
 * still the latest after parsing. A failed read keeps the last good data and
 * reports it as stale; nothing becomes an empty list or a zero.
 */
import * as React from "react";
import { mergeTrackedPosition } from "@/lib/ops/live-positions";
import { mergeSnapshot, type LivePing, type StreamMode } from "@/lib/ops/live-feed-types";
import type { LiveBoardPayload } from "@/lib/ops/live-board-types";

export const SNAPSHOT_POLL_MS = 15_000;
export const BOARD_POLL_MS = 30_000;

type Loadable<T> = { data: T; status: "loading" | "ready" | "error"; updatedAt: number | null };

export type LiveFeed = {
  pings: Loadable<LivePing[]>;
  board: Loadable<LiveBoardPayload | null>;
  stream: { mode: StreamMode; lastMessageAt: number | null };
  reloadBoard: () => void;
};

const LiveFeedContext = React.createContext<LiveFeed | null>(null);

export function useLiveFeed(): LiveFeed {
  const feed = React.useContext(LiveFeedContext);
  if (!feed) throw new Error("useLiveFeed must be used inside LiveFeedProvider");
  return feed;
}

function usePolledJson<T>(url: string, intervalMs: number, apply: (value: unknown) => T | null) {
  const [state, setState] = React.useState<{ value: T | null; status: Loadable<T>["status"]; updatedAt: number | null }>({ value: null, status: "loading", updatedAt: null });
  const latest = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  const applyRef = React.useRef(apply);
  applyRef.current = apply;

  const load = React.useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const request = ++latest.current;
    try {
      const response = await fetch(url, { cache: "no-store", signal: current.signal, headers: { "x-progress-toast": "off" } });
      if (!response.ok) throw new Error(String(response.status));
      const body: unknown = await response.json();
      if (current.signal.aborted || request !== latest.current) return;
      const value = applyRef.current(body);
      if (value === null) throw new Error("Unexpected response");
      setState({ value, status: "ready", updatedAt: Date.now() });
    } catch {
      if (current.signal.aborted || request !== latest.current) return;
      setState((previous) => ({ ...previous, status: "error" }));
    }
  }, [url]);

  React.useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      controller.current?.abort();
    };
  }, [load, intervalMs]);

  return { ...state, reload: load };
}

export function LiveFeedProvider({ children, initialBoard = null }: { children: React.ReactNode; initialBoard?: LiveBoardPayload | null }) {
  const [pings, setPings] = React.useState<LivePing[]>([]);
  const [stream, setStream] = React.useState<LiveFeed["stream"]>({ mode: "connecting", lastMessageAt: null });

  const snapshot = usePolledJson<LivePing[]>("/api/admin/ops/live-locations", SNAPSHOT_POLL_MS, (body) => {
    const rows = (body as { pings?: unknown }).pings;
    if (!Array.isArray(rows)) return null;
    setPings((previous) => mergeSnapshot(previous, rows as LivePing[]));
    return rows as LivePing[];
  });
  const board = usePolledJson<LiveBoardPayload>("/api/admin/ops/live-board", BOARD_POLL_MS, (body) => {
    const value = body as Partial<LiveBoardPayload>;
    return Array.isArray(value.jobs) && value.counts ? (value as LiveBoardPayload) : null;
  });

  React.useEffect(() => {
    // Automated browsers keep "network idle" by polling only (the stream would never settle).
    if (typeof EventSource === "undefined" || (typeof navigator !== "undefined" && navigator.webdriver)) {
      setStream({ mode: "off", lastMessageAt: null });
      return;
    }
    const source = new EventSource("/api/admin/ops/live-locations/stream");
    source.onopen = () => setStream((current) => ({ mode: "open", lastMessageAt: current.lastMessageAt ?? Date.now() }));
    source.onerror = () => setStream((current) => ({ ...current, mode: "error" }));
    source.onmessage = (event) => {
      setStream({ mode: "open", lastMessageAt: Date.now() });
      try {
        const message = JSON.parse(event.data) as { type?: string; ping?: LivePing };
        if (message.type === "ping" && message.ping) {
          const incoming = message.ping;
          setPings((previous) => mergeTrackedPosition(previous, incoming));
        }
      } catch {
        // A malformed message changes nothing.
      }
    };
    return () => source.close();
  }, []);

  const value = React.useMemo<LiveFeed>(() => ({
    pings: { data: pings, status: snapshot.status, updatedAt: snapshot.updatedAt },
    board: { data: board.value ?? initialBoard, status: board.value || initialBoard ? (board.status === "loading" ? "ready" : board.status) : board.status, updatedAt: board.updatedAt },
    stream,
    reloadBoard: () => void board.reload(),
  }), [pings, snapshot.status, snapshot.updatedAt, board, initialBoard, stream]);

  return <LiveFeedContext.Provider value={value}>{children}</LiveFeedContext.Provider>;
}
