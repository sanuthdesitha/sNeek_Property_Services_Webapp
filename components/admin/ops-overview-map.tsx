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
  liveStatus?: "EN_ROUTE" | "ON_SITE" | "IDLE";
  activeJob?: {
    id: string;
    jobNumber: string | null;
    status: string;
    propertyName: string;
    etaMinutes: number | null;
  } | null;
  timer?: { startedAt: string; elapsedMinutes: number } | null;
};

const POLL_INTERVAL_MS = 15_000;

function staleColor(timestamp: string): string {
  const s = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (s < 120) return "#22c55e"; // fresh — green
  if (s < 600) return "#f59e0b"; // aging — amber
  return "#ef4444"; // stale — red
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function liveStatusLabel(ping: RawPing): string {
  if (ping.liveStatus === "EN_ROUTE") return "En route";
  if (ping.liveStatus === "ON_SITE") return "On site";
  return "Idle";
}

function formatElapsed(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function formatClockIn(startedAt: string): string {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Plain-text tooltip (marker title) for a cleaner dot. */
function cleanerTooltip(ping: RawPing): string {
  const name = ping.user?.name ?? "Cleaner";
  const parts = [`${name} — ${liveStatusLabel(ping)}`];
  if (ping.activeJob) {
    parts.push(`${ping.activeJob.propertyName}${ping.activeJob.jobNumber ? ` (#${ping.activeJob.jobNumber})` : ""}`);
  }
  if (ping.timer) {
    parts.push(`Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(ping.timer.elapsedMinutes)}`);
  }
  return parts.join("\n");
}

/** Rich InfoWindow HTML for a cleaner dot. */
function cleanerInfoHtml(ping: RawPing): string {
  const name = escapeHtml(ping.user?.name ?? "Cleaner");
  const rows: string[] = [
    `<div style="font:600 13px system-ui;color:#111">${name} <span style="font-weight:500;color:#0e7490">· ${liveStatusLabel(ping)}</span></div>`,
  ];
  if (ping.activeJob) {
    const jobLabel = `${escapeHtml(ping.activeJob.propertyName)}${
      ping.activeJob.jobNumber ? ` <span style="color:#555">#${escapeHtml(String(ping.activeJob.jobNumber))}</span>` : ""
    }`;
    rows.push(
      `<div style="font:400 12px system-ui;color:#333;margin-top:4px">${jobLabel} · ${escapeHtml(
        ping.activeJob.status.replace(/_/g, " ").toLowerCase(),
      )}</div>`,
      `<a href="/admin/jobs/${encodeURIComponent(ping.activeJob.id)}" style="font:500 12px system-ui;color:#0e7490">Open job →</a>`,
    );
  }
  if (ping.timer) {
    rows.push(
      `<div style="font:400 12px system-ui;color:#333;margin-top:4px">Clocked in ${formatClockIn(
        ping.timer.startedAt,
      )} · elapsed ${formatElapsed(ping.timer.elapsedMinutes)}</div>`,
    );
  }
  if (!ping.activeJob && !ping.timer) {
    rows.push(`<div style="font:400 12px system-ui;color:#555;margin-top:4px">No active job or running timer.</div>`);
  }
  rows.push(
    `<div style="font:400 11px system-ui;color:#777;margin-top:4px">Last ping ${escapeHtml(
      new Date(ping.timestamp).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false }),
    )}${ping.accuracy != null ? ` · ±${Math.round(ping.accuracy)}m` : ""}</div>`,
  );
  return `<div style="max-width:240px">${rows.join("")}</div>`;
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
  const cleanerMarkersRef = useRef<Map<string, { marker: any; info: any }>>(new Map());
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
          const tooltip = cleanerTooltip(ping);
          const infoHtml = cleanerInfoHtml(ping);
          const existing = cleanerMarkersRef.current.get(ping.userId);
          if (existing) {
            existing.marker.setPosition(pos);
            existing.marker.setIcon(icon);
            existing.marker.setTitle(tooltip);
            existing.info.setContent(infoHtml);
          } else {
            const marker = new google.maps.Marker({ position: pos, map, title: tooltip, icon, zIndex: 20 });
            const info = new google.maps.InfoWindow({ content: infoHtml });
            marker.addListener("click", () => info.open({ map, anchor: marker }));
            cleanerMarkersRef.current.set(ping.userId, { marker, info });
          }
        }

        // Drop markers for cleaners that stopped pinging.
        cleanerMarkersRef.current.forEach((entry, userId) => {
          if (!seen.has(userId)) {
            entry.info.close();
            entry.marker.setMap(null);
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
