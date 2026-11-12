/**
 * The live position feed shared by the Live ops list and map: snapshot rows
 * from GET /api/admin/ops/live-locations, merged with pings from the
 * /stream EventSource. Pure helpers only (client-safe).
 */
import type { LiveStatusCode } from "./live-status";

export type LivePing = {
  userId: string;
  user?: { name?: string | null } | null;
  lat: number | null;
  lng: number | null;
  accuracy?: number | null;
  timestamp: string | null;
  lastPingAt?: string | null;
  positionSource?: "gps" | "property" | "none";
  stale?: boolean;
  pingAgeMinutes?: number | null;
  liveStatus?: LiveStatusCode;
  liveLabel?: string | null;
  activeJob?: {
    id: string;
    jobNumber: string | number | null;
    status: string;
    propertyName: string;
    etaMinutes: number | null;
  } | null;
  timer?: { startedAt: string; elapsedMinutes: number } | null;
};

export type StreamMode = "connecting" | "open" | "error" | "off";

/** No message (pings or the 60 s heartbeat) for this long means the stream is stale. */
export const STREAM_STALE_AFTER_MS = 2 * 60_000;

export type StreamIndicator = { tone: "ok" | "warn" | "bad" | "neutral"; label: string };

export function streamIndicator(input: { mode: StreamMode; lastMessageAt: number | null; lastSnapshotAt: number | null; now: number; timeZone: string }): StreamIndicator {
  const since = (at: number | null) =>
    at ? new Date(at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: input.timeZone }) : null;
  if (input.mode === "off") {
    return input.lastSnapshotAt ? { tone: "neutral", label: `Refreshing every 15 s · updated ${since(input.lastSnapshotAt)}` } : { tone: "neutral", label: "Connecting…" };
  }
  if (input.mode === "connecting") return { tone: "neutral", label: "Connecting…" };
  if (input.mode === "error") {
    return { tone: "warn", label: input.lastMessageAt ? `Reconnecting · last update ${since(input.lastMessageAt)}` : "Reconnecting…" };
  }
  if (input.lastMessageAt && input.now - input.lastMessageAt > STREAM_STALE_AFTER_MS) {
    return { tone: "bad", label: `Stale since ${since(input.lastMessageAt)}` };
  }
  return { tone: "ok", label: "Live" };
}

/** Age of the freshest GPS position, in seconds; null when nobody has one. */
export function freshestPositionAgeSeconds(pings: LivePing[], now: number): number | null {
  let freshest: number | null = null;
  for (const ping of pings) {
    if (ping.positionSource !== "gps") continue;
    const at = Date.parse(ping.lastPingAt ?? ping.timestamp ?? "");
    if (Number.isFinite(at) && (freshest === null || at > freshest)) freshest = at;
  }
  return freshest === null ? null : Math.max(0, Math.round((now - freshest) / 1000));
}

/**
 * Merge a fresh snapshot into the current list: a newer streamed position is
 * kept over an older snapshot position (the snapshot still supplies status).
 */
export function mergeSnapshot(previous: LivePing[], snapshot: LivePing[]): LivePing[] {
  return snapshot.map((row) => {
    const current = previous.find((item) => item.userId === row.userId);
    if (!current) return row;
    const currentAt = Date.parse(current.lastPingAt ?? current.timestamp ?? "");
    const rowAt = Date.parse(row.lastPingAt ?? row.timestamp ?? "");
    if (!Number.isFinite(currentAt) || (Number.isFinite(rowAt) && currentAt <= rowAt)) return row;
    return { ...row, lat: current.lat, lng: current.lng, timestamp: current.timestamp, lastPingAt: current.lastPingAt, accuracy: current.accuracy, positionSource: current.positionSource };
  });
}
