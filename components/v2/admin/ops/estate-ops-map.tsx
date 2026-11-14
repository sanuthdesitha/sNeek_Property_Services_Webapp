"use client";

/**
 * ESTATE live operations map (presentational). It draws what the Live ops
 * feed provider hands it — cleaner positions, laundry drivers, today's board
 * rows and property pins — and does not poll or stream on its own, so the
 * list and the map share one feed. Clicking a pin selects that person (the
 * page shows their card) and opens their info window.
 *
 * Pins (2026-11, owner request "redo how the pins are shown"): labelled pills
 * as in the approved LiveOps / M-CalendarLiveOps designs, drawn as DOM in one
 * google.maps.OverlayView (`ops-map-overlay.ts`, no mapId needed). The pin
 * model is the pure `ops-map-pins.ts`; the pills are `ops-map-pin-views.tsx`.
 * People closer than one pill on screen stack into one group ("+N" for more
 * than three). Properties are a quiet house glyph, named when zoomed in or
 * when one of today's jobs is there.
 *
 * Live location 2026-11: an accuracy ring around every GPS position; the
 * staleness tier, approximate fix, job-address fallback and "no fix" states
 * are written on the pill (see ops-map-pins); "Show today's trail" draws the
 * selected person's bounded, audited trail.
 *
 * Google Maps mounts through the shared lib/maps/loader (runtime key config).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair } from "lucide-react";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import type { LivePing } from "@/lib/ops/live-feed-types";
import type { LiveDriverRow, LiveJobRow } from "@/lib/ops/live-board-types";
import { cleanerInfoHtml, driverInfoHtml, hasPosition, propertyInfoHtml, staleTier, type OpsMapProperty } from "./estate-ops-map-parts";
import {
  buildPersonPins, buildPropertyPins, groupOverlappingPins, showPropertyLabel,
  type PersonPin, type PinGroup, type PropertyPin,
} from "./ops-map-pins";
import { OpsMapLegend, PersonPinStack, PropertyPinButton } from "./ops-map-pin-views";
import { createPinOverlay, type PinOverlay } from "./ops-map-overlay";

export type { OpsMapProperty } from "./estate-ops-map-parts";

export type MapLayers = { cleaners: boolean; drivers: boolean; properties: boolean };

type MapProps = {
  properties: OpsMapProperty[];
  pings: LivePing[];
  drivers: LiveDriverRow[];
  /** Today's board rows (already in the feed): late minutes, off site, today's job at a property. */
  jobs?: LiveJobRow[];
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
type LatLng = { lat: number; lng: number };
type TrailPoint = { lat: number; lng: number; accuracy: number | null; measuredAt: string };
type TrailState =
  | { status: "idle" }
  | { status: "loading"; userId: string }
  | { status: "ready"; userId: string; points: TrailPoint[]; truncated: boolean }
  | { status: "error"; userId: string };
/** What the open info window shows, so its content follows feed updates. */
type InfoTarget = { kind: "person"; key: string } | { kind: "property" } | null;

// Phone: the map is its own screen, so it takes most of the viewport (sm: and up unchanged).
const MAP_HEIGHT = "h-[62vh] min-h-[320px] sm:h-[440px] xl:h-[600px]";
const EMPTY_JOBS: LiveJobRow[] = [];
/** Pins re-judge freshness this often even without a new position. */
const FRESHNESS_TICK_MS = 30_000;
/** The initials badge centre sits on the point: pill left padding + half the badge. */
const BADGE_CENTRE_PX = 13;

function google(): MapsHandle {
  return (window as unknown as { google?: MapsHandle }).google;
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function personPosition(userId: string, pings: LivePing[], drivers: LiveDriverRow[]): LatLng | null {
  const ping = pings.find((item) => item.userId === userId && hasPosition(item));
  if (ping) return { lat: ping.lat as number, lng: ping.lng as number };
  const driver = drivers.find((item) => item.userId === userId && item.lat != null && item.lng != null);
  return driver ? { lat: driver.lat as number, lng: driver.lng as number } : null;
}

function personInfoHtml(userId: string, pings: LivePing[], drivers: LiveDriverRow[]): string | null {
  const ping = pings.find((item) => item.userId === userId && hasPosition(item));
  if (ping) return cleanerInfoHtml(ping);
  const driver = drivers.find((item) => item.userId === userId);
  return driver ? driverInfoHtml(driver) : null;
}

function groupLayer(group: PinGroup<PersonPin>, expanded: boolean): number {
  // An expanded stack can reach over its neighbours, so it is drawn on top.
  if (expanded) return 40;
  if (group.members.some((pin) => pin.selected)) return 30;
  if (group.members.some((pin) => pin.alert)) return 20;
  return 10;
}

/** The pins, rendered into the overlay pane at their projected positions. */
function PinLayer({
  overlay, groups, propertyPins, zoom, expanded, selectedUserId, onPerson, onProperty, onToggleGroup,
}: {
  overlay: PinOverlay;
  groups: PinGroup<PersonPin>[];
  propertyPins: PropertyPin[];
  zoom: number;
  expanded: ReadonlySet<string>;
  selectedUserId: string | null;
  onPerson: (pin: PersonPin) => void;
  onProperty: (pin: PropertyPin) => void;
  onToggleGroup: (groupId: string) => void;
}) {
  return (
    <>
      {groups.map((group) => {
        const at = overlay.toPixel(group.lat, group.lng);
        if (!at) return null;
        return (
          <div
            key={group.id}
            className="absolute"
            style={{ left: at.x, top: at.y, zIndex: groupLayer(group, expanded.has(group.id)), transform: `translate(-${BADGE_CENTRE_PX}px, calc(-100% + ${BADGE_CENTRE_PX}px))` }}
          >
            <PersonPinStack group={group} expanded={expanded.has(group.id)} selectedKey={selectedUserId} onActivate={onPerson} onToggle={onToggleGroup} />
          </div>
        );
      })}
      {propertyPins.map((pin) => {
        const at = overlay.toPixel(pin.lat, pin.lng);
        if (!at) return null;
        return (
          <div key={pin.key} className="absolute" style={{ left: at.x, top: at.y, zIndex: 1, transform: "translate(-9px, -50%)" }}>
            <PropertyPinButton pin={pin} showLabel={showPropertyLabel(pin, zoom)} onActivate={onProperty} />
          </div>
        );
      })}
    </>
  );
}

export function EstateOpsMap({ properties, pings, drivers, jobs = EMPTY_JOBS, layers, selectedUserId, onSelect, overlay, refitKey }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsHandle>(null);
  const pinOverlay = useRef<PinOverlay | null>(null);
  const infoWindow = useRef<MapsHandle>(null);
  const infoTarget = useRef<InfoTarget>(null);
  const fitted = useRef(false);
  const accuracyRings = useRef<Map<string, MapsHandle>>(new Map());
  const trailLine = useRef<MapsHandle>(null);
  const [trail, setTrail] = useState<TrailState>({ status: "idle" });
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [overlayReady, setOverlayReady] = useState(false);
  // Bumped by the overlay's draw (projection changed); pixel positions follow it.
  const [, setDrawCount] = useState(0);
  const [zoom, setZoom] = useState(11);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const now = useTick(FRESHNESS_TICK_MS);

  useEffect(() => {
    ensureGoogleMaps()
      .then(() => (google()?.maps?.Map ? setMapReady(true) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    const g = google();
    const map = new g.maps.Map(containerRef.current, {
      center: { lat: -33.8688, lng: 151.2093 }, zoom: 11, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: "greedy",
    });
    mapRef.current = map;
    infoWindow.current = new g.maps.InfoWindow({ pixelOffset: new g.maps.Size(0, -14) });
    pinOverlay.current = createPinOverlay(g, map, () => {
      setDrawCount((count) => count + 1);
      const current = map.getZoom?.();
      if (typeof current === "number") setZoom(current);
    });
    setOverlayReady(true);
  }, [mapReady]);

  useEffect(() => () => {
    infoWindow.current?.close();
    pinOverlay.current?.remove();
  }, []);

  const personPins = useMemo(
    () => buildPersonPins({ pings, drivers, jobs, showCleaners: layers.cleaners, showDrivers: layers.drivers, selectedUserId, now }),
    [pings, drivers, jobs, layers.cleaners, layers.drivers, selectedUserId, now],
  );
  const groups = useMemo(() => groupOverlappingPins(personPins, zoom), [personPins, zoom]);
  const propertyPins = useMemo(() => (layers.properties ? buildPropertyPins(properties, jobs) : []), [layers.properties, properties, jobs]);

  const openInfo = useCallback((position: LatLng, html: string, target: InfoTarget) => {
    const info = infoWindow.current;
    if (!info || !mapRef.current) return;
    info.setContent(html);
    info.setPosition(position);
    info.open({ map: mapRef.current });
    infoTarget.current = target;
  }, []);

  const activatePerson = useCallback((pin: PersonPin) => {
    onSelect(pin.key);
    const html = personInfoHtml(pin.key, pings, drivers);
    if (html) openInfo({ lat: pin.lat, lng: pin.lng }, html, { kind: "person", key: pin.key });
  }, [onSelect, openInfo, pings, drivers]);

  const activateProperty = useCallback((pin: PropertyPin) => {
    const html = propertyInfoHtml({ name: pin.name, suburb: pin.suburb, lat: pin.lat, lng: pin.lng, jobId: pin.todayJobId, status: pin.todayLabel });
    openInfo({ lat: pin.lat, lng: pin.lng }, html, { kind: "property" });
  }, [openInfo]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // An open person info window follows their position and status.
  useEffect(() => {
    const target = infoTarget.current;
    if (!target || target.kind !== "person" || !infoWindow.current) return;
    const position = personPosition(target.key, pings, drivers);
    const html = personInfoHtml(target.key, pings, drivers);
    if (!position || !html) {
      infoWindow.current.close();
      infoTarget.current = null;
      return;
    }
    infoWindow.current.setContent(html);
    infoWindow.current.setPosition(position);
  }, [pings, drivers]);

  // Accuracy rings (the true position is somewhere inside) and the first fit.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const g = google();
    const ringsWanted = new Map<string, { center: LatLng; radius: number; color: string }>();
    if (layers.cleaners) {
      for (const ping of pings) {
        if (!hasPosition(ping) || ping.positionSource !== "gps" || ping.accuracy == null || ping.accuracy <= 0) continue;
        ringsWanted.set(`c:${ping.userId}`, { center: { lat: ping.lat as number, lng: ping.lng as number }, radius: Math.min(ping.accuracy, 5_000), color: staleTier(ping.timestamp).color });
      }
    }
    if (layers.drivers) {
      for (const driver of drivers) {
        if (driver.lat == null || driver.lng == null || driver.accuracy == null || driver.accuracy <= 0) continue;
        ringsWanted.set(`d:${driver.userId}`, { center: { lat: driver.lat, lng: driver.lng }, radius: Math.min(driver.accuracy, 5_000), color: staleTier(driver.lastPingAt).color });
      }
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

    const cleanerPositions = layers.cleaners ? pings.filter(hasPosition) : [];
    if (!fitted.current && cleanerPositions.length > 0) {
      const bounds = new g.maps.LatLngBounds();
      cleanerPositions.forEach((ping) => bounds.extend({ lat: ping.lat as number, lng: ping.lng as number }));
      map.fitBounds(bounds, 56);
      fitted.current = true;
    }
  }, [mapReady, pings, drivers, layers.cleaners, layers.drivers]);

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
    const position = personPosition(selectedUserId, pings, drivers);
    if (!position) return;
    map.panTo(position);
    if (typeof map.getZoom === "function" && map.getZoom() < 14) map.setZoom(14);
    // Only when the selection changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const position = selectedUserId ? personPosition(selectedUserId, pings, drivers) : null;
      if (position && mapRef.current) mapRef.current.panTo(position);
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
        {overlayReady && pinOverlay.current
          ? createPortal(
              <PinLayer
                overlay={pinOverlay.current}
                groups={groups}
                propertyPins={propertyPins}
                zoom={zoom}
                expanded={expandedGroups}
                selectedUserId={selectedUserId}
                onPerson={activatePerson}
                onProperty={activateProperty}
                onToggleGroup={toggleGroup}
              />,
              pinOverlay.current.container,
            )
          : null}
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
      <OpsMapLegend />
    </div>
  );
}
