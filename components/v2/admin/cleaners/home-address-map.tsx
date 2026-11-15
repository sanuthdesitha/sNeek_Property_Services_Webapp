"use client";

/**
 * Cleaner home addresses map: SUBURB-LEVEL pins only. The data it receives has
 * no street address and no stored position (the server sends the suburb
 * centre, or a ~2 km square's centre), so neither the map nor a screenshot of
 * it can show where anyone lives. Same Google loader, overlay layer and pin
 * pills as Live ops; people in one suburb stack ("+N").
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { ensureGoogleMaps, resolveBrowserMapsKey } from "@/lib/maps/loader";
import { createPinOverlay, type PinOverlay } from "@/components/v2/admin/ops/ops-map-overlay";
import { groupOverlappingPins, type PersonPin } from "@/components/v2/admin/ops/ops-map-pins";
import { PersonPinStack, PinBadge, personPillClass, type PinLook } from "@/components/v2/admin/ops/ops-map-pin-views";

/* Google Maps has no types installed in this project; the handles stay opaque. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type MapsHandle = any;

/** What the map is given: suburb-level positions only. */
export type SuburbPin = {
  cleanerId: string;
  initials: string;
  name: string;
  suburb: string;
  lat: number;
  lng: number;
  suburbOnly: boolean;
  basis: "suburb_centre" | "area_square";
};

type MapState = "checking" | "not_configured" | "loading" | "ready" | "failed";

const SYDNEY = { lat: -33.8688, lng: 151.2093 };
const HEIGHT = "h-[420px] lg:h-[560px]";
const BADGE_CENTRE_PX = 13;

function google(): MapsHandle {
  return (window as unknown as { google?: MapsHandle }).google;
}

/** A suburb pin as a Live ops pill: placed = filled badge; suburb only = gold badge, dashed pill. */
export function suburbPersonPin(pin: SuburbPin, selectedId: string | null): PersonPin {
  const where = pin.basis === "suburb_centre" ? `pin at the ${pin.suburb} suburb centre` : `pin on the area around ${pin.suburb}, about 2 km across`;
  return {
    key: pin.cleanerId,
    kind: "cleaner",
    lat: pin.lat,
    lng: pin.lng,
    initials: pin.initials,
    shortName: pin.suburb,
    status: null,
    qualifier: pin.suburbOnly ? "suburb only" : null,
    tone: pin.suburbOnly ? "gold" : "success",
    alert: false,
    freshness: "live",
    precision: pin.suburbOnly ? "approximate" : "gps",
    selected: pin.cleanerId === selectedId,
    rank: pin.suburbOnly ? 1 : 0,
    ariaLabel: `${pin.name}: home in ${pin.suburb}${pin.suburbOnly ? ", suburb only, no street address" : ""}; ${where}, never on the house.${pin.cleanerId === selectedId ? " Selected." : ""}`,
  };
}

const LEGEND_PLACED: PinLook = { initials: "AB", tone: "success", alert: false, freshness: "live", precision: "gps", selected: false };
const LEGEND_SUBURB: PinLook = { initials: "AB", tone: "gold", alert: false, freshness: "live", precision: "approximate", selected: false };

export function HomeAddressMapKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[hsl(var(--e-border))] px-4 py-2.5 text-[0.75rem]" role="group" aria-label="Map key">
      <span className="inline-flex items-center gap-1.5"><span className={cn(personPillClass(LEGEND_PLACED), "h-[22px] shadow-none")} aria-hidden><PinBadge look={LEGEND_PLACED} /></span>placed, at the suburb</span>
      <span className="inline-flex items-center gap-1.5"><span className={cn(personPillClass(LEGEND_SUBURB), "h-[22px] shadow-none")} aria-hidden><PinBadge look={LEGEND_SUBURB} /></span>suburb only, no street</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-flex h-[22px] items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[10px] font-semibold" aria-hidden>+2</span>more in one suburb</span>
    </div>
  );
}

export function HomeAddressMap({ pins, selectedId, onSelect, mapConfigured }: { pins: SuburbPin[]; selectedId: string | null; onSelect: (cleanerId: string) => void; mapConfigured: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsHandle>(null);
  const overlay = useRef<PinOverlay | null>(null);
  const [state, setState] = useState<MapState>(mapConfigured ? "checking" : "not_configured");
  const [overlayReady, setOverlayReady] = useState(false);
  const [zoom, setZoom] = useState(11);
  const [, setDraw] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!mapConfigured) return;
    let cancelled = false;
    (async () => {
      const key = await resolveBrowserMapsKey();
      if (cancelled) return;
      if (!key) {
        setState("not_configured");
        return;
      }
      setState("loading");
      try {
        await ensureGoogleMaps();
        if (!cancelled) setState(google()?.maps?.Map ? "ready" : "failed");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapConfigured]);

  useEffect(() => {
    if (state !== "ready" || !containerRef.current || mapRef.current) return;
    const g = google();
    const map = new g.maps.Map(containerRef.current, { center: SYDNEY, zoom: 11, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative", clickableIcons: false, maxZoom: 14 });
    mapRef.current = map;
    overlay.current = createPinOverlay(g, map, () => {
      setDraw((count) => count + 1);
      const current = map.getZoom?.();
      if (typeof current === "number") setZoom(current);
    });
    setOverlayReady(true);
    if (pins.length > 0) {
      const bounds = new g.maps.LatLngBounds();
      pins.forEach((pin) => bounds.extend({ lat: pin.lat, lng: pin.lng }));
      map.fitBounds(bounds, 56);
    }
    // The pins are fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => () => overlay.current?.remove(), []);

  const personPins = useMemo(() => pins.map((pin) => suburbPersonPin(pin, selectedId)), [pins, selectedId]);
  const groups = useMemo(() => groupOverlappingPins(personPins, zoom), [personPins, zoom]);
  const toggle = useCallback((id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }), []);

  if (state === "not_configured" || state === "failed") {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 p-6 text-center" role={state === "failed" ? "alert" : "status"}>
        <p className="text-[0.9375rem] font-[600]">{state === "failed" ? "The map is unavailable right now" : "The map is not configured"}</p>
        <p className="max-w-sm text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {state === "failed" ? "The table still shows every address." : "No Google Maps key is set (Settings › Integrations). The table still shows every address and the On the map column."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative" role="region" aria-label="Map of cleaners' suburbs (suburb level, never the house)">
      {state !== "ready" ? <div className={cn("w-full animate-pulse bg-[hsl(var(--e-surface-raised))]", HEIGHT)} role="status" aria-label="Loading the map" /> : null}
      <div ref={containerRef} className={cn("w-full", HEIGHT, state === "ready" ? "" : "hidden")} />
      {overlayReady && overlay.current
        ? createPortal(
            <>
              {groups.map((group) => {
                const at = overlay.current?.toPixel(group.lat, group.lng);
                if (!at) return null;
                return (
                  <div key={group.id} className="absolute" style={{ left: at.x, top: at.y, zIndex: expanded.has(group.id) ? 40 : group.members.some((pin) => pin.selected) ? 30 : 10, transform: `translate(-${BADGE_CENTRE_PX}px, calc(-100% + ${BADGE_CENTRE_PX}px))` }}>
                    <PersonPinStack group={group} expanded={expanded.has(group.id)} selectedKey={selectedId} onActivate={(pin) => onSelect(pin.key)} onToggle={toggle} />
                  </div>
                );
              })}
            </>,
            overlay.current.container,
          )
        : null}
    </div>
  );
}
