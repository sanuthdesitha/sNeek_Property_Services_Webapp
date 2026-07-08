"use client";

/**
 * ESTATE live operations map — full parity with the classic ops live map,
 * built natively for Estate chrome (no dependency on components/admin/*).
 *
 * - Property/job pins are server-provided via props.
 * - Cleaner positions are seeded + refreshed from /api/admin/ops/live-locations
 *   (the enriched snapshot: liveStatus, active job, ETA, running timer) every
 *   15s, and stream in live between polls via the same EventSource feed the
 *   classic map uses (/api/admin/ops/live-locations/stream).
 * - Each cleaner renders as a staleness-coloured dot with a name label, a rich
 *   info window (status · active job · ETA · clock-in elapsed), and an entry in
 *   the side panel — click a panel row to pan/zoom the map to that cleaner.
 *
 * Google Maps mounts through the shared lib/maps/loader (runtime key config).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, RadioTower } from "lucide-react";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import { EBadge } from "@/components/v2/ui/primitives";

export type OpsMapProperty = {
  /** Present when the pin represents an active job (deep-links to the job). */
  jobId?: string | null;
  name: string;
  suburb?: string | null;
  lat: number;
  lng: number;
  status?: string | null;
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
    jobNumber: string | number | null;
    status: string;
    propertyName: string;
    etaMinutes: number | null;
  } | null;
  timer?: { startedAt: string; elapsedMinutes: number } | null;
};

const POLL_INTERVAL_MS = 15_000;

// ── Staleness (seconds since last ping → colour tier) ────────────────────
const STALE_TIERS = [
  { maxSeconds: 120, color: "#3f9b6d", label: "Fresh (< 2 min)" },
  { maxSeconds: 600, color: "#c99a2e", label: "Aging (< 10 min)" },
  { maxSeconds: Infinity, color: "#b4472e", label: "Stale (10 min +)" },
] as const;

function staleTier(timestamp: string) {
  const s = (Date.now() - new Date(timestamp).getTime()) / 1000;
  return STALE_TIERS.find((t) => s < t.maxSeconds) ?? STALE_TIERS[STALE_TIERS.length - 1];
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

function liveStatusTone(ping: RawPing): "info" | "success" | "neutral" {
  if (ping.liveStatus === "EN_ROUTE") return "info";
  if (ping.liveStatus === "ON_SITE") return "success";
  return "neutral";
}

function formatElapsed(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function elapsedFromStart(startedAt: string, fallbackMinutes: number): number {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return fallbackMinutes;
  return Math.max(0, Math.round((Date.now() - started) / 60_000));
}

function formatClockIn(startedAt: string): string {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatEta(etaMinutes: number | null): string | null {
  if (etaMinutes == null) return null;
  if (etaMinutes <= 1) return "Arriving now";
  const arrival = new Date(Date.now() + etaMinutes * 60_000);
  const time = arrival.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  return `ETA ${Math.round(etaMinutes)} min · ~${time}`;
}

function relativePing(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
}

function cleanerName(ping: RawPing): string {
  return ping.user?.name ?? ping.userId.slice(0, 8);
}

function cleanerTooltip(ping: RawPing): string {
  const parts = [`${cleanerName(ping)} — ${liveStatusLabel(ping)}`];
  if (ping.activeJob) {
    parts.push(
      `${ping.activeJob.propertyName}${ping.activeJob.jobNumber ? ` (#${ping.activeJob.jobNumber})` : ""}`,
    );
    const eta = formatEta(ping.activeJob.etaMinutes);
    if (eta && ping.liveStatus === "EN_ROUTE") parts.push(eta);
  }
  if (ping.timer) {
    parts.push(
      `Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(elapsedFromStart(ping.timer.startedAt, ping.timer.elapsedMinutes))}`,
    );
  }
  parts.push(`Last ping ${relativePing(ping.timestamp)}`);
  return parts.join("\n");
}

function cleanerInfoHtml(ping: RawPing): string {
  const name = escapeHtml(cleanerName(ping));
  const rows: string[] = [
    `<div style="font:600 13px system-ui;color:#2a241d">${name} <span style="font-weight:500;color:#7a6f2e">· ${liveStatusLabel(ping)}</span></div>`,
  ];
  if (ping.activeJob) {
    const jobLabel = `${escapeHtml(ping.activeJob.propertyName)}${ping.activeJob.jobNumber ? ` <span style="color:#8a7f70">#${escapeHtml(String(ping.activeJob.jobNumber))}</span>` : ""}`;
    rows.push(
      `<div style="font:400 12px system-ui;color:#4a4238;margin-top:4px">${jobLabel} · ${escapeHtml(ping.activeJob.status.replace(/_/g, " ").toLowerCase())}</div>`,
    );
    const eta = formatEta(ping.activeJob.etaMinutes);
    if (eta && ping.liveStatus === "EN_ROUTE") {
      rows.push(`<div style="font:500 12px system-ui;color:#7a6f2e;margin-top:2px">${escapeHtml(eta)}</div>`);
    }
    rows.push(
      `<a href="/v2/admin/jobs/${encodeURIComponent(ping.activeJob.id)}" style="font:500 12px system-ui;color:#7a6f2e">Open job →</a>`,
    );
  }
  if (ping.timer) {
    rows.push(
      `<div style="font:400 12px system-ui;color:#4a4238;margin-top:4px">Clocked in ${formatClockIn(ping.timer.startedAt)} · elapsed ${formatElapsed(elapsedFromStart(ping.timer.startedAt, ping.timer.elapsedMinutes))}</div>`,
    );
  }
  if (!ping.activeJob && !ping.timer) {
    rows.push(`<div style="font:400 12px system-ui;color:#8a7f70;margin-top:4px">No active job or running timer.</div>`);
  }
  rows.push(
    `<div style="font:400 11px system-ui;color:#a39a8a;margin-top:4px">Last ping ${escapeHtml(relativePing(ping.timestamp))}${ping.accuracy != null ? ` · ±${Math.round(ping.accuracy)}m` : ""}</div>`,
  );
  return `<div style="max-width:240px">${rows.join("")}</div>`;
}

function propertyInfoHtml(p: OpsMapProperty): string {
  const status = p.status ? ` · ${escapeHtml(p.status.replace(/_/g, " "))}` : "";
  const link = p.jobId
    ? `<br/><a href="/v2/admin/jobs/${encodeURIComponent(p.jobId)}" style="color:#7a6f2e">Open job →</a>`
    : "";
  return `<div style="font:500 13px system-ui;color:#2a241d">${escapeHtml(p.name)}<br/><span style="font-weight:400;color:#8a7f70">${escapeHtml(p.suburb ?? "")}${status}</span>${link}</div>`;
}

export function EstateOpsMap({ properties }: { properties: OpsMapProperty[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const cleanerMarkersRef = useRef<Map<string, { marker: any; info: any }>>(new Map());
  const openInfoRef = useRef<any>(null);
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pings, setPings] = useState<RawPing[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // ── Load the Maps script (runtime key via /api/public/maps-config) ─────
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

  // ── Mount the map + property/job pins ──────────────────────────────────
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
        title: `${p.name}${p.suburb ? ` · ${p.suburb}` : ""}${p.status ? ` — ${p.status.replace(/_/g, " ")}` : ""}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#7a6f2e",
          fillOpacity: 0.55,
          strokeColor: "#7a6f2e",
          strokeWeight: 1,
        },
      });
      const info = new google.maps.InfoWindow({ content: propertyInfoHtml(p) });
      marker.addListener("click", () => {
        openInfoRef.current?.close();
        info.open({ map, anchor: marker });
        openInfoRef.current = info;
      });
      bounds.extend({ lat: p.lat, lng: p.lng });
      hasPoint = true;
    }

    if (hasPoint) {
      map.fitBounds(bounds, 56);
      fittedRef.current = true;
    }
  }, [mapReady, properties]);

  // ── 15s snapshot poll (enriched: status, active job, ETA, timer) ───────
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/ops/live-locations", {
          cache: "no-store",
          headers: { "x-progress-toast": "off" },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { pings?: RawPing[] };
        if (cancelled) return;
        setPings(Array.isArray(data.pings) ? data.pings : []);
        setLastUpdated(new Date());
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
  }, []);

  // ── SSE live position stream (same feed the classic map consumed) ──────
  useEffect(() => {
    // Skip the always-open stream under automated browsers (preview/e2e) so it
    // doesn't block "network idle" and hang capture tooling. Real users unaffected.
    if (typeof navigator !== "undefined" && navigator.webdriver) return;
    const es = new EventSource("/api/admin/ops/live-locations/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; ping?: RawPing };
        if (msg.type !== "ping" || !msg.ping) return;
        const incoming = msg.ping;
        setPings((prev) => {
          const idx = prev.findIndex((p) => p.userId === incoming.userId);
          if (idx === -1) return [...prev, incoming];
          // Keep the enriched snapshot fields (status/job/timer); only refresh
          // the position and freshness from the streamed raw ping.
          const next = prev.slice();
          next[idx] = {
            ...next[idx],
            lat: incoming.lat,
            lng: incoming.lng,
            accuracy: incoming.accuracy ?? next[idx].accuracy,
            timestamp: incoming.timestamp,
          };
          return next;
        });
        setLastUpdated(new Date());
      } catch {
        // malformed — ignore
      }
    };
    return () => es.close();
  }, []);

  // ── Sync cleaner markers with state ────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const google = (window as any).google;
    const map = mapRef.current;
    if (!google?.maps) return;

    const seen = new Set<string>();
    for (const ping of pings) {
      seen.add(ping.userId);
      const pos = { lat: ping.lat, lng: ping.lng };
      const icon = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: staleTier(ping.timestamp).color,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        labelOrigin: new google.maps.Point(0, -2.4),
      };
      const label = {
        text: cleanerName(ping),
        fontSize: "11px",
        fontWeight: "600",
        color: "#2a241d",
      };
      const existing = cleanerMarkersRef.current.get(ping.userId);
      if (existing) {
        existing.marker.setPosition(pos);
        existing.marker.setIcon(icon);
        existing.marker.setLabel(label);
        existing.marker.setTitle(cleanerTooltip(ping));
        existing.info.setContent(cleanerInfoHtml(ping));
      } else {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          title: cleanerTooltip(ping),
          icon,
          label,
          zIndex: 20,
        });
        const info = new google.maps.InfoWindow({ content: cleanerInfoHtml(ping) });
        marker.addListener("click", () => {
          openInfoRef.current?.close();
          info.open({ map, anchor: marker });
          openInfoRef.current = info;
        });
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

    if (!fittedRef.current && pings.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      for (const ping of pings) bounds.extend({ lat: ping.lat, lng: ping.lng });
      map.fitBounds(bounds, 56);
      fittedRef.current = true;
    }
  }, [mapReady, pings]);

  // ── Panel row → pan/zoom to that cleaner + open their info window ──────
  const focusCleaner = useCallback((userId: string) => {
    const map = mapRef.current;
    const entry = cleanerMarkersRef.current.get(userId);
    if (!map || !entry) return;
    map.panTo(entry.marker.getPosition());
    const zoom = typeof map.getZoom === "function" ? map.getZoom() : 11;
    if (typeof zoom === "number" && zoom < 14) map.setZoom(14);
    openInfoRef.current?.close();
    entry.info.open({ map, anchor: entry.marker });
    openInfoRef.current = entry.info;
  }, []);

  if (loadFailed) {
    return (
      <div className="flex h-[440px] w-full items-center justify-center rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] px-4 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Map unavailable — check the Google Maps API key in System → Integrations.
      </div>
    );
  }

  const sortedPings = pings.slice().sort((a, b) => cleanerName(a).localeCompare(cleanerName(b)));

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* ── Map ─────────────────────────────────────────────────────── */}
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
              <span
                className={`h-2 w-2 rounded-full ${pings.length > 0 ? "animate-pulse bg-[hsl(var(--e-success))]" : "bg-[hsl(var(--e-muted-foreground)/0.4)]"}`}
              />
              {pings.length} cleaner{pings.length === 1 ? "" : "s"} live
              {lastUpdated
                ? ` · updated ${lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}`
                : ""}
            </div>
          ) : null}
        </div>

        {/* ── Live cleaner side panel ─────────────────────────────────── */}
        <div className="flex max-h-[440px] flex-col overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <div className="flex items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">
              <RadioTower className="h-3.5 w-3.5 text-[hsl(var(--e-accent-portal))]" aria-hidden />
              Live cleaners
            </p>
            <EBadge tone={pings.length > 0 ? "success" : "neutral"} soft>
              {pings.length}
            </EBadge>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {sortedPings.length === 0 ? (
              <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-8 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No cleaners are live right now. They appear here while en route
                or clocked in on a job.
              </p>
            ) : (
              <div className="space-y-1.5">
                {sortedPings.map((ping) => {
                  const tier = staleTier(ping.timestamp);
                  const eta =
                    ping.liveStatus === "EN_ROUTE" && ping.activeJob
                      ? formatEta(ping.activeJob.etaMinutes)
                      : null;
                  return (
                    <button
                      key={ping.userId}
                      type="button"
                      onClick={() => focusCleaner(ping.userId)}
                      className="group w-full rounded-[var(--e-radius)] border border-transparent px-2.5 py-2 text-left transition-colors hover:border-[hsl(var(--e-border))] hover:bg-[hsl(var(--e-muted))]"
                      title="Focus on map"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white"
                          style={{ backgroundColor: tier.color }}
                          aria-hidden
                        />
                        <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
                          {cleanerName(ping)}
                        </p>
                        <EBadge tone={liveStatusTone(ping)} soft>
                          {liveStatusLabel(ping)}
                        </EBadge>
                        <Crosshair
                          className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-text-faint))] opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      </div>
                      {ping.activeJob ? (
                        <p className="mt-1 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {ping.activeJob.propertyName}
                          {ping.activeJob.jobNumber ? ` · #${ping.activeJob.jobNumber}` : ""}
                        </p>
                      ) : null}
                      {eta ? (
                        <p className="mt-0.5 text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))]">{eta}</p>
                      ) : null}
                      {ping.timer ? (
                        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          Clocked in {formatClockIn(ping.timer.startedAt)} · elapsed{" "}
                          {formatElapsed(elapsedFromStart(ping.timer.startedAt, ping.timer.elapsedMinutes))}
                        </p>
                      ) : null}
                      <p className="e-tnum mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        Last ping {relativePing(ping.timestamp)}
                        {ping.accuracy != null ? ` · ±${Math.round(ping.accuracy)}m` : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Legend + refresh cadence ──────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        {STALE_TIERS.map((tier) => (
          <span key={tier.label} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-white"
              style={{ backgroundColor: tier.color }}
              aria-hidden
            />
            {tier.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#7a6f2e] opacity-55" aria-hidden />
          Property / job
        </span>
        <span className="ml-auto">Live stream + 15s snapshot refresh</span>
      </div>
    </div>
  );
}
