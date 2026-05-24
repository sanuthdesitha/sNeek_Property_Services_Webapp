"use client";

import { useEffect, useState } from "react";

interface PingMarker {
  userId: string;
  userName: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
}

interface RawPing {
  userId: string;
  user?: { name?: string | null } | null;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
}

/**
 * Real-time list view of every cleaner pinging in the last 15 minutes.
 * Subscribes to /api/admin/ops/live-locations/stream via EventSource and
 * folds each ping into a userId-keyed Map so newer fixes overwrite older
 * ones. Markers are color-coded by staleness (green < 2m, amber < 10m,
 * red beyond).
 *
 * TODO: swap the list rows for a real map renderer (Leaflet or Mapbox)
 * once a tile provider is wired into env config.
 */
export default function LiveMapPage() {
  const [markers, setMarkers] = useState<Map<string, PingMarker>>(new Map());
  const [now, setNow] = useState<number>(() => Date.now());

  // Re-tick every 5s so the staleness label refreshes even without new pings.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  // Initial snapshot.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/ops/live-locations")
      .then((r) => r.json())
      .then((data: { pings: RawPing[] }) => {
        if (cancelled) return;
        const m = new Map<string, PingMarker>();
        for (const p of data.pings ?? []) {
          m.set(p.userId, {
            userId: p.userId,
            userName: p.user?.name ?? "Unnamed cleaner",
            lat: p.lat,
            lng: p.lng,
            accuracy: p.accuracy,
            timestamp: p.timestamp,
          });
        }
        setMarkers(m);
      })
      .catch(() => {
        // Snapshot failure is non-fatal — SSE will populate markers as pings arrive.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates via SSE.
  useEffect(() => {
    const es = new EventSource("/api/admin/ops/live-locations/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          ping?: RawPing;
        };
        if (msg.type === "ping" && msg.ping) {
          const p = msg.ping;
          setMarkers((prev) => {
            const next = new Map(prev);
            next.set(p.userId, {
              userId: p.userId,
              userName: p.user?.name ?? "Unnamed cleaner",
              lat: p.lat,
              lng: p.lng,
              accuracy: p.accuracy,
              timestamp: p.timestamp,
            });
            return next;
          });
        }
      } catch {
        // Malformed event — ignore.
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    return () => es.close();
  }, []);

  const staleSeconds = (ts: string) => (now - new Date(ts).getTime()) / 1000;
  const colorFor = (s: number) =>
    s < 120 ? "bg-success" : s < 600 ? "bg-warning" : "bg-destructive";
  const formatAccuracy = (a?: number | null) =>
    typeof a === "number" ? `±${a.toFixed(0)} m` : "±? m";
  const formatStale = (s: number) =>
    s < 60 ? `${s.toFixed(0)}s ago` : `${(s / 60).toFixed(0)}m ago`;

  const list = Array.from(markers.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">Live Ops Map</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {list.length} cleaner{list.length === 1 ? "" : "s"} active (last 15 min) ·
        updates stream live
      </p>
      <div className="mt-6 grid gap-3">
        {list.map((m) => {
          const s = staleSeconds(m.timestamp);
          return (
            <div
              key={m.userId}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4"
            >
              <span
                className={`size-3 rounded-full ${colorFor(s)}`}
                aria-hidden
              />
              <div className="flex-1">
                <p className="font-medium">{m.userName}</p>
                <p className="text-xs text-muted-foreground">
                  {m.lat.toFixed(5)}, {m.lng.toFixed(5)} · accuracy {formatAccuracy(m.accuracy)}
                </p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {formatStale(s)}
              </span>
            </div>
          );
        })}
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">No active cleaners.</p>
        )}
      </div>
    </div>
  );
}
