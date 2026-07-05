"use client";

/**
 * ESTATE live operations map — mounts a Google Map (via the shared
 * lib/maps/loader, the same runtime key config the classic map uses) inside
 * Estate chrome. Property pins are server-provided; cleaner GPS pings poll the
 * same /api/admin/ops/live-locations feed every 15s. No dependency on the
 * classic components/admin/* map components.
 */
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
  activeJob?: { id: string; jobNumber: string | null; status: string; propertyName: string; etaMinutes: number | null } | null;
  timer?: { startedAt: string; elapsedMinutes: number } | null;
};

const POLL_INTERVAL_MS = 15_000;

function staleColor(timestamp: string): string {
  const s = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (s < 120) return "#3f9b6d"; // fresh
  if (s < 600) return "#c99a2e"; // aging
  return "#b4472e"; // stale
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

function cleanerTooltip(ping: RawPing): string {
  const name = ping.user?.name ?? "Cleaner";
  const parts = [`${name} — ${liveStatusLabel(ping)}`];
  if (ping.activeJob) parts.push(`${ping.activeJob.propertyName}${ping.activeJob.jobNumber ? ` (#${ping.activeJob.jobNumber})` : ""}`);
  if (ping.timer) parts.push(`Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(ping.timer.elapsedMinutes)}`);
  return parts.join("\n");
}

function cleanerInfoHtml(ping: RawPing): string {
  const name = escapeHtml(ping.user?.name ?? "Cleaner");
  const rows: string[] = [
    `<div style="font:600 13px system-ui;color:#2a241d">${name} <span style="font-weight:500;color:#7a6f2e">· ${liveStatusLabel(ping)}</span></div>`,
  ];
  if (ping.activeJob) {
    const jobLabel = `${escapeHtml(ping.activeJob.propertyName)}${ping.activeJob.jobNumber ? ` <span style="color:#8a7f70">#${escapeHtml(String(ping.activeJob.jobNumber))}</span>` : ""}`;
    rows.push(
      `<div style="font:400 12px system-ui;color:#4a4238;margin-top:4px">${jobLabel} · ${escapeHtml(ping.activeJob.status.replace(/_/g, " ").toLowerCase())}</div>`,
      `<a href="/admin/jobs/${encodeURIComponent(ping.activeJob.id)}" style="font:500 12px system-ui;color:#7a6f2e">Open job →</a>`,
    );
  }
  if (ping.timer) {
    rows.push(`<div style="font:400 12px system-ui;color:#4a4238;margin-top:4px">Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(ping.timer.elapsedMinutes)}</div>`);
  }
  if (!ping.activeJob && !ping.timer) rows.push(`<div style="font:400 12px system-ui;color:#8a7f70;margin-top:4px">No active job or running timer.</div>`);
  rows.push(
    `<div style="font:400 11px system-ui;color:#a39a8a;margin-top:4px">Last ping ${escapeHtml(new Date(ping.timestamp).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false }))}${ping.accuracy != null ? ` · ±${Math.round(ping.accuracy)}m` : ""}</div>`,
  );
  return `<div style="max-width:240px">${rows.join("")}</div>`;
}

export function EstateOpsMap({ properties }: { properties: OpsMapProperty[] }) {
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
        content: `<div style="font:500 13px system-ui;color:#2a241d">${escapeHtml(p.name)}<br/><span style="font-weight:400;color:#8a7f70">${escapeHtml(p.suburb ?? "")} · ${p.status.replace(/_/g, " ")}</span><br/><a href="/admin/jobs/${p.jobId}" style="color:#7a6f2e">Open job →</a></div>`,
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

  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/ops/live-locations", { cache: "no-store", headers: { "x-progress-toast": "off" } });
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
          const existing = cleanerMarkersRef.current.get(ping.userId);
          if (existing) {
            existing.marker.setPosition(pos);
            existing.marker.setIcon(icon);
            existing.marker.setTitle(cleanerTooltip(ping));
            existing.info.setContent(cleanerInfoHtml(ping));
          } else {
            const marker = new google.maps.Marker({ position: pos, map, title: cleanerTooltip(ping), icon, zIndex: 20 });
            const info = new google.maps.InfoWindow({ content: cleanerInfoHtml(ping) });
            marker.addListener("click", () => info.open({ map, anchor: marker }));
            cleanerMarkersRef.current.set(ping.userId, { marker, info });
          }
        }

        cleanerMarkersRef.current.forEach((entry, userId) => {
          if (!seen.has(userId)) {
            entry.info.close();
            entry.marker.setMap(null);
            cleanerMarkersRef.current.delete(userId);
          }
        });

        setLiveCount(pings.length);

        if (!fittedRef.current && pings.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          for (const ping of pings) bounds.extend({ lat: ping.lat, lng: ping.lng });
          map.fitBounds(bounds, 56);
          fittedRef.current = true;
        }
      } catch {
        // transient — next tick retries
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
      <div className="flex h-[440px] w-full items-center justify-center rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] px-4 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Map unavailable — check the Google Maps API key in System → Integrations.
      </div>
    );
  }

  return (
    <div className="relative">
      {!mapReady ? (
        <div className="h-[440px] w-full animate-pulse rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]" />
      ) : null}
      <div
        ref={containerRef}
        className={`h-[440px] w-full overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] ${mapReady ? "" : "hidden"}`}
      />
      {mapReady ? (
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.92)] px-3 py-1.5 text-[0.75rem] font-[550] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)] backdrop-blur">
          <span className={`h-2 w-2 rounded-full ${liveCount > 0 ? "animate-pulse bg-[hsl(var(--e-success))]" : "bg-[hsl(var(--e-muted-foreground)/0.4)]"}`} />
          {liveCount} cleaner{liveCount === 1 ? "" : "s"} live · refreshes every 15s
        </div>
      ) : null}
    </div>
  );
}
