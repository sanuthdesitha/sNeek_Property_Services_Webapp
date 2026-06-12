"use client";

import { useEffect, useRef, useState } from "react";
import { ensureGoogleMaps } from "@/lib/maps/loader";

export type OpsMapProperty = {
  jobId: string;
  name: string;
  suburb: string | null;
  lat: number;
  lng: number;
  status: string;
};

type RawPing = {
  userId: string;
  user?: { name?: string | null } | null;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
};

const POLL_INTERVAL_MS = 15_000;

function staleColor(timestamp: string): string {
  const s = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (s < 120) return "#22c55e"; // fresh — green
  if (s < 600) return "#f59e0b"; // aging — amber
  return "#ef4444"; // stale — red
}

/**
 * Full live operations map: every active job's property as a pin plus every
 * cleaner GPS ping from the last 15 minutes as a colour-coded dot
 * (green < 2m, amber < 10m, red beyond). Cleaner positions refresh on a
 * 15s poll; property pins come from the server-rendered page.
 */
export function OpsOverviewMap({ properties }: { properties: OpsMapProperty[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const cleanerMarkersRef = useRef<Map<string, any>>(new Map());
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [liveCount, setLiveCount] = useState(0);

  useEffect(() => {
    ensureGoogleMaps()
      .then(() => {
        const google = (window as any).google;
        if (!google?.maps?.Map) {
          setLoadFailed(true);
          return;
        }
        setMapReady(true);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  // Build map + property pins once ready.
  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    const google = (window as any).google;

    const map = new google.maps.Map(containerRef.current, {
      center: { lat: -33.8688, lng: 151.2093 },
      zoom: 11,
      disableDefaultUI: true,
      zoomControl: true,
      fullscreenControl: true,
      gestureHandling: "greedy",
    });
    mapRef.current = map;

    const bounds = new google.maps.LatLngBounds();
    let hasPoint = false;

    for (const p of properties) {
      const marker = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map,
        title: `${p.name}${p.suburb ? ` · ${p.suburb}` : ""} — ${p.status.replace(/_/g, " ")}`,
      });
      const info = new google.maps.InfoWindow({
        content: `<div style="font:500 13px system-ui;color:#111">${p.name}<br/><span style="font-weight:400;color:#555">${p.suburb ?? ""} · ${p.status.replace(/_/g, " ")}</span><br/><a href="/admin/jobs/${p.jobId}" style="color:#0e7490">Open job →</a></div>`,
      });
      marker.addListener("click", () => info.open({ map, anchor: marker }));
      bounds.extend({ lat: p.lat, lng: p.lng });
      hasPoint = true;
    }

    if (hasPoint) {
      map.fitBounds(bounds, 56);
      fittedRef.current = true;
    }
  }, [mapReady, properties]);

  // Poll live cleaner pings and fold into markers.
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/ops/live-locations", {
          cache: "no-store",
          headers: { "x-progress-toast": "off" },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { pings?: RawPing[] };
        const google = (window as any).google;
        const map = mapRef.current;
        if (!google?.maps || !map || cancelled) return;

        const pings = data.pings ?? [];
        const seen = new Set<string>();

        for (const ping of pings) {
          seen.add(ping.userId);
          const pos = { lat: ping.lat, lng: ping.lng };
          const icon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: staleColor(ping.timestamp),
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          };
          const label = ping.user?.name ?? "Cleaner";
          const existing = cleanerMarkersRef.current.get(ping.userId);
          if (existing) {
            existing.setPosition(pos);
            existing.setIcon(icon);
            existing.setTitle(label);
          } else {
            cleanerMarkersRef.current.set(
              ping.userId,
              new google.maps.Marker({ position: pos, map, title: label, icon, zIndex: 20 }),
            );
          }
        }

        // Drop markers for cleaners that stopped pinging.
        cleanerMarkersRef.current.forEach((marker, userId) => {
          if (!seen.has(userId)) {
            marker.setMap(null);
            cleanerMarkersRef.current.delete(userId);
          }
        });

        setLiveCount(pings.length);

        // If there were no property pins, fit to the first batch of cleaners.
        if (!fittedRef.current && pings.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          for (const ping of pings) bounds.extend({ lat: ping.lat, lng: ping.lng });
          map.fitBounds(bounds, 56);
          fittedRef.current = true;
        }
      } catch {
        // Transient polling failure — next tick retries.
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mapReady]);

  if (loadFailed) {
    return (
      <div className="flex h-[420px] w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted px-4 text-center text-sm text-muted-foreground">
        Map unavailable — check the Google Maps API key in Settings → Integrations.
      </div>
    );
  }

  return (
    <div className="relative">
      {!mapReady ? (
        <div className="skeleton h-[420px] w-full rounded-xl border border-border" />
      ) : null}
      <div
        ref={containerRef}
        className={`h-[420px] w-full overflow-hidden rounded-xl border border-border ${mapReady ? "" : "hidden"}`}
      />
      {mapReady ? (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${liveCount > 0 ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
          {liveCount} cleaner{liveCount === 1 ? "" : "s"} live · refreshes every 15s
        </div>
      ) : null}
    </div>
  );
}
