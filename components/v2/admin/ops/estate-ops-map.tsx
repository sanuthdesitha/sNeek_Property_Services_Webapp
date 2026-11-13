"use client";

/**
 * ESTATE live operations map (presentational). It draws what the Live ops
 * feed provider hands it — cleaner positions, laundry drivers and property
 * pins — and no longer polls or streams on its own, so the list and the map
 * share one feed. Cleaner dots keep their staleness colour, name label,
 * hollow "no GPS, shown at the job address" style and info window; clicking a
 * dot selects that person (the page shows their card).
 *
 * Live location 2026-11: an accuracy ring around every GPS dot; a fix coarser
 * than 100 m is drawn hollow ("approximate"); drivers take the same age
 * colours as cleaners; people at the same spot are spread on a small circle;
 * "Show today's trail" draws the selected person's bounded, audited trail.
 *
 * Google Maps mounts through the shared lib/maps/loader (runtime key config).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import type { LivePing } from "@/lib/ops/live-feed-types";
import type { LiveDriverRow } from "@/lib/ops/live-board-types";
import {
  STALE_TIERS, cleanerInfoHtml, cleanerName, cleanerTooltip, escapeHtml, hasPosition, propertyInfoHtml, spreadOverlapping, staleTier,
  type OpsMapProperty,
} from "./estate-ops-map-parts";
import { isApproximateFix, trackingStateLabel } from "@/lib/gps/staleness";
import { formatRelativeAgo } from "@/lib/ops/live-status";

export type { OpsMapProperty } from "./estate-ops-map-parts";

export type MapLayers = { cleaners: boolean; drivers: boolean; properties: boolean };

type MapProps = {
  properties: OpsMapProperty[];
  pings: LivePing[];
  drivers: LiveDriverRow[];
  layers: MapLayers;
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
  /** Overlay (the selected person's card) drawn over the map's top-right corner. */
  overlay?: React.ReactNode;
  /**
   * Phone: changes when the map screen is shown again. A map laid out while
   * hidden has no size, so it re-fits to everyone once it is visible.
   */
  refitKey?: string;
};

// Google Maps has no types installed in this project; the handles stay opaque.
/* eslint-disable @typescript-eslint/no-explicit-any */
type MapsHandle = any;
type MarkerEntry = { marker: MapsHandle; info: MapsHandle };
type TrailPoint = { lat: number; lng: number; accuracy: number | null; measuredAt: string };
type TrailState =
  | { status: "idle" }
  | { status: "loading"; userId: string }
  | { status: "ready"; userId: string; points: TrailPoint[]; truncated: boolean }
  | { status: "error"; userId: string };

// Phone: the map is its own screen, so it takes most of the viewport (sm: and up unchanged).
const MAP_HEIGHT = "h-[62vh] min-h-[320px] sm:h-[440px] xl:h-[600px]";
const DRIVER_COLOR = "#b8913f";

function google(): MapsHandle {
  return (window as unknown as { google?: MapsHandle }).google;
}

function syncMarkers(map: MapsHandle, store: Map<string, MarkerEntry>, wanted: Array<{ key: string; pos: { lat: number; lng: number }; icon: MapsHandle; label: MapsHandle; title: string; html: string }>, onClick: (key: string, entry: MarkerEntry) => void) {
  const g = google();
  const seen = new Set<string>();
  for (const want of wanted) {
    seen.add(want.key);
    const existing = store.get(want.key);
    if (existing) {
      existing.marker.setPosition(want.pos);
      existing.marker.setIcon(want.icon);
      existing.marker.setLabel(want.label);
      existing.marker.setTitle(want.title);
      existing.info.setContent(want.html);
      continue;
    }
    const marker = new g.maps.Marker({ position: want.pos, map, title: want.title, icon: want.icon, label: want.label, zIndex: 20 });
    const info = new g.maps.InfoWindow({ content: want.html });
    const entry = { marker, info };
    marker.addListener("click", () => onClick(want.key, entry));
    store.set(want.key, entry);
  }
  store.forEach((entry, key) => {
    if (!seen.has(key)) {
      entry.info.close();
      entry.marker.setMap(null);
      store.delete(key);
    }
  });
}

export function EstateOpsMap({ properties, pings, drivers, layers, selectedUserId, onSelect, overlay, refitKey }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsHandle>(null);
  const cleanerMarkers = useRef<Map<string, MarkerEntry>>(new Map());
  const driverMarkers = useRef<Map<string, MarkerEntry>>(new Map());
  const propertyMarkers = useRef<MapsHandle[]>([]);
  const openInfo = useRef<MapsHandle>(null);
  const fitted = useRef(false);
  const accuracyRings = useRef<Map<string, MapsHandle>>(new Map());
  const trailLine = useRef<MapsHandle>(null);
  const [trail, setTrail] = useState<TrailState>({ status: "idle" });
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    ensureGoogleMaps()
      .then(() => (google()?.maps?.Map ? setMapReady(true) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true));
  }, []);

  const openEntry = useCallback((entry: MarkerEntry) => {
    openInfo.current?.close();
    entry.info.open({ map: mapRef.current, anchor: entry.marker });
    openInfo.current = entry.info;
  }, []);

  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    mapRef.current = new (google().maps.Map)(containerRef.current, {
      center: { lat: -33.8688, lng: 151.2093 }, zoom: 11, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: "greedy",
    });
  }, [mapReady]);

  // Property pins (layer toggle).
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const g = google();
    propertyMarkers.current.forEach((marker) => marker.setMap(null));
    propertyMarkers.current = [];
    if (!layers.properties) return;
    for (const p of properties) {
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map,
        title: `${p.name}${p.suburb ? ` · ${p.suburb}` : ""}${p.status ? ` — ${p.status.replace(/_/g, " ")}` : ""}`,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#7a6f2e", fillOpacity: 0.55, strokeColor: "#7a6f2e", strokeWeight: 1 },
      });
      const info = new g.maps.InfoWindow({ content: propertyInfoHtml(p) });
      marker.addListener("click", () => openEntry({ marker, info }));
      propertyMarkers.current.push(marker);
    }
  }, [mapReady, properties, layers.properties, openEntry]);

  // Cleaner dots and laundry drivers share one placement pass so people at
  // the same spot are spread instead of stacked.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const g = google();
    const cleanerPoints = layers.cleaners
      ? pings.filter(hasPosition).map((ping) => ({ key: `c:${ping.userId}`, lat: ping.lat as number, lng: ping.lng as number, ping }))
      : [];
    const driverPoints = layers.drivers
      ? drivers.filter((d) => d.lat != null && d.lng != null).map((driver) => ({ key: `d:${driver.userId}`, lat: driver.lat as number, lng: driver.lng as number, driver }))
      : [];
    const placed = spreadOverlapping<{ key: string; lat: number; lng: number; ping?: LivePing; driver?: LiveDriverRow }>([...cleanerPoints, ...driverPoints]);

    const wantedCleaners = placed.filter((p) => p.ping).map((p) => {
      const ping = p.ping as LivePing;
      const fallback = ping.positionSource === "property";
      const approximate = !fallback && isApproximateFix(ping.accuracy);
      const selected = ping.userId === selectedUserId;
      const tier = staleTier(ping.timestamp);
      return {
        key: ping.userId,
        pos: { lat: p.displayLat, lng: p.displayLng },
        icon: {
          path: g.maps.SymbolPath.CIRCLE, scale: selected ? 10 : 8,
          fillColor: fallback ? "#ffffff" : tier.color, fillOpacity: fallback ? 0.15 : approximate ? 0.25 : 1,
          strokeColor: fallback ? "#8a7f70" : approximate ? tier.color : selected ? "#1f3d33" : "#ffffff", strokeWeight: selected || approximate ? 3 : 2,
          labelOrigin: new g.maps.Point(0, -2.4),
        },
        label: { text: cleanerName(ping), fontSize: "11px", fontWeight: "600", color: "#2a241d" },
        title: `${cleanerTooltip(ping)}${approximate ? "\nApproximate position" : ""}${p.groupSize > 1 ? `\n${p.groupSize} people here` : ""}`,
        html: cleanerInfoHtml(ping),
      };
    });
    syncMarkers(map, cleanerMarkers.current, wantedCleaners, (key, entry) => { onSelect(key); openEntry(entry); });

    const wantedDrivers = placed.filter((p) => p.driver).map((p) => {
      const driver = p.driver as LiveDriverRow;
      const tier = staleTier(driver.lastPingAt);
      const approximate = isApproximateFix(driver.accuracy ?? null);
      const reason = trackingStateLabel(driver.trackingState ?? null);
      const age = driver.lastPingAt ? `Last fix ${formatRelativeAgo(driver.lastPingAt)}${driver.accuracy != null ? ` · ±${Math.round(driver.accuracy)}m` : ""}` : "No GPS yet";
      return {
        key: driver.userId,
        pos: { lat: p.displayLat, lng: p.displayLng },
        icon: {
          path: g.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6, fillColor: tier.color, fillOpacity: approximate ? 0.3 : 1,
          strokeColor: approximate ? tier.color : DRIVER_COLOR, strokeWeight: 2, labelOrigin: new g.maps.Point(0, -3),
        },
        label: { text: driver.name, fontSize: "11px", fontWeight: "600", color: "#2a241d" },
        title: `${driver.name} — laundry driver, stop ${Math.min(driver.stopsDone + 1, driver.stopsTotal)} of ${driver.stopsTotal}\n${age}${reason ? `\nPhone reports: ${reason}` : ""}`,
        html: `<div style="font:600 13px system-ui;color:#2a241d">${escapeHtml(driver.name)}</div><div style="font:400 12px system-ui;color:#4a4238">Laundry route · ${driver.stopsDone} of ${driver.stopsTotal} stops done</div><div style="font:400 11px system-ui;color:#a39a8a;margin-top:4px">${escapeHtml(age)}</div>${reason ? `<div style="font:500 11px system-ui;color:#b4472e">Phone reports: ${escapeHtml(reason)}</div>` : ""}`,
      };
    });
    syncMarkers(map, driverMarkers.current, wantedDrivers, (key, entry) => { onSelect(key); openEntry(entry); });

    // Accuracy rings: the true position is somewhere inside.
    const ringsWanted = new Map<string, { center: { lat: number; lng: number }; radius: number; color: string }>();
    for (const point of cleanerPoints) {
      const ping = point.ping;
      if (ping.positionSource !== "gps" || ping.accuracy == null || ping.accuracy <= 0) continue;
      ringsWanted.set(point.key, { center: { lat: point.lat, lng: point.lng }, radius: Math.min(ping.accuracy, 5_000), color: staleTier(ping.timestamp).color });
    }
    for (const point of driverPoints) {
      const accuracy = point.driver.accuracy;
      if (accuracy == null || accuracy <= 0) continue;
      ringsWanted.set(point.key, { center: { lat: point.lat, lng: point.lng }, radius: Math.min(accuracy, 5_000), color: staleTier(point.driver.lastPingAt).color });
    }
    ringsWanted.forEach((ring, key) => {
      const existing = accuracyRings.current.get(key);
      const options = { center: ring.center, radius: ring.radius, strokeColor: ring.color, strokeOpacity: 0.55, strokeWeight: 1, fillColor: ring.color, fillOpacity: 0.08, clickable: false };
      if (existing) existing.setOptions(options);
      else accuracyRings.current.set(key, new g.maps.Circle({ ...options, map }));
    });
    accuracyRings.current.forEach((circle, key) => {
      if (!ringsWanted.has(key)) {
        circle.setMap(null);
        accuracyRings.current.delete(key);
      }
    });

    if (!fitted.current && wantedCleaners.length > 0) {
      const bounds = new g.maps.LatLngBounds();
      wantedCleaners.forEach((w) => bounds.extend(w.pos));
      map.fitBounds(bounds, 56);
      fitted.current = true;
    }
  }, [mapReady, pings, drivers, layers.cleaners, layers.drivers, selectedUserId, onSelect, openEntry]);

  // A trail belongs to one selected person; changing the selection drops it.
  useEffect(() => {
    setTrail({ status: "idle" });
  }, [selectedUserId]);

  const trailController = useRef<AbortController | null>(null);
  useEffect(() => () => trailController.current?.abort(), []);
  const loadTrail = useCallback(async () => {
    if (!selectedUserId) return;
    const userId = selectedUserId;
    trailController.current?.abort();
    const controller = new AbortController();
    trailController.current = controller;
    setTrail({ status: "loading", userId });
    try {
      const response = await fetch(`/api/admin/ops/live-locations/trail?userId=${encodeURIComponent(userId)}`, { cache: "no-store", signal: controller.signal, headers: { "x-progress-toast": "off" } });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { points?: TrailPoint[]; truncated?: boolean };
      if (controller.signal.aborted) return;
      setTrail({ status: "ready", userId, points: Array.isArray(body.points) ? body.points : [], truncated: body.truncated === true });
    } catch {
      if (!controller.signal.aborted) setTrail({ status: "error", userId });
    }
  }, [selectedUserId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    trailLine.current?.setMap(null);
    trailLine.current = null;
    if (trail.status !== "ready" || trail.userId !== selectedUserId || trail.points.length < 2) return;
    trailLine.current = new (google().maps.Polyline)({
      map, path: trail.points.map((point) => ({ lat: point.lat, lng: point.lng })), geodesic: true,
      strokeColor: "#1f3d33", strokeOpacity: 0.75, strokeWeight: 3, clickable: false,
    });
  }, [mapReady, trail, selectedUserId]);

  // Selecting someone in the list pans to them.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !selectedUserId) return;
    const entry = cleanerMarkers.current.get(selectedUserId) ?? driverMarkers.current.get(selectedUserId);
    if (!entry) return;
    map.panTo(entry.marker.getPosition());
    if (typeof map.getZoom === "function" && map.getZoom() < 14) map.setZoom(14);
  }, [mapReady, selectedUserId]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = new (google().maps.LatLngBounds)();
    let any = false;
    for (const ping of pings) {
      if (hasPosition(ping)) { bounds.extend({ lat: ping.lat as number, lng: ping.lng as number }); any = true; }
    }
    if (any) map.fitBounds(bounds, 56);
  }, [pings]);

  useEffect(() => {
    if (!refitKey || refitKey === "hidden" || !mapReady) return;
    const frame = window.requestAnimationFrame(() => {
      const entry = selectedUserId ? cleanerMarkers.current.get(selectedUserId) ?? driverMarkers.current.get(selectedUserId) : null;
      if (entry && mapRef.current) mapRef.current.panTo(entry.marker.getPosition());
      else fitAll();
    });
    return () => window.cancelAnimationFrame(frame);
    // Only when the screen is shown again, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refitKey, mapReady]);

  if (loadFailed) {
    return (
      <div className="space-y-3 p-4">
        <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Map unavailable — check the Google Maps API key in System → Integrations. The lists beside it still update.
        </p>
        {overlay}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <div className="relative" role="region" aria-label="Map of cleaner and driver positions">
        {!mapReady ? <div className={`${MAP_HEIGHT} w-full animate-pulse bg-[hsl(var(--e-surface-raised))]`} /> : null}
        <div ref={containerRef} className={`${MAP_HEIGHT} w-full ${mapReady ? "" : "hidden"}`} />
        {mapReady && pings.some(hasPosition) ? (
          <button type="button" onClick={fitAll} className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.92)] px-3 py-1.5 text-[0.75rem] font-[550] shadow-[var(--e-elevation-1)] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            <Crosshair className="h-3.5 w-3.5" aria-hidden /> Fit all
          </button>
        ) : null}
        {mapReady && selectedUserId ? (
          <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 max-sm:bottom-auto max-sm:top-14">
            <button type="button" onClick={() => void loadTrail()} disabled={trail.status === "loading"} className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.92)] px-3 py-1.5 text-[0.75rem] font-[550] shadow-[var(--e-elevation-1)] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] disabled:opacity-60">
              {trail.status === "loading" ? "Loading trail…" : trail.status === "ready" ? "Refresh today's trail" : "Show today's trail"}
            </button>
            <span role="status" className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-surface)/0.92)] px-2 py-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
              {trail.status === "error" ? "Trail could not be loaded." : trail.status === "ready" ? (trail.points.length < 2 ? "No trail recorded today." : `${trail.points.length} points today${trail.truncated ? " (latest 500)" : ""} · viewing is recorded`) : null}
            </span>
          </div>
        ) : null}
        {overlay ? <div className="pointer-events-none absolute right-3 top-3 w-[230px] max-w-[calc(100%-1.5rem)] max-sm:bottom-3 max-sm:left-3 max-sm:top-auto max-sm:w-auto [&>*]:pointer-events-auto">{overlay}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        {STALE_TIERS.map((tier) => (
          <span key={tier.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-1 ring-white" style={{ backgroundColor: tier.color }} aria-hidden />{tier.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#8a7f70]" aria-hidden />No GPS · shown at job address</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#3f9b6d] bg-[#3f9b6d]/25" aria-hidden />Approximate (± over 100 m) · ring shows accuracy</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent" style={{ borderTopColor: DRIVER_COLOR }} aria-hidden />Laundry driver</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#7a6f2e] opacity-55" aria-hidden />Property</span>
      </div>
    </div>
  );
}
