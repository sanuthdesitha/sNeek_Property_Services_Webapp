"use client";

/**
 * The route map's map: one Google map through the shared loader
 * (`lib/maps/loader`), pins drawn as DOM in the Live ops pin layer
 * (`createPinOverlay`) with `RouteStopPin`, and one polyline per route in the
 * route's colour AND line pattern. No second map stack: the loader, overlay
 * and pin family are the Live ops ones.
 *
 * Without a Maps key the map says it is not configured; the list beside it
 * works fully either way. Gestures are "cooperative" (two fingers pan on a
 * phone) so scrolling the page never moves the map by accident.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crosshair } from "lucide-react";
import { ensureGoogleMaps, resolveBrowserMapsKey } from "@/lib/maps/loader";
import { routeLook } from "@/lib/ops/route-plan";
import { createPinOverlay, type PinOverlay } from "@/components/v2/admin/ops/ops-map-overlay";
import { RouteStopPin } from "@/components/v2/admin/ops/ops-map-pin-views";
import { polylineOptions, resolveRouteColour } from "./route-lines";
import type { MapPin, MapRouteLine } from "./route-map-model";

/* Google Maps has no types installed in this project; the handles stay opaque. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type MapsHandle = any;

type MapState = "checking" | "not_configured" | "loading" | "ready" | "failed";

const SYDNEY = { lat: -33.8688, lng: 151.2093 };
const PIN_HALF = 15;

function google(): MapsHandle {
  return (window as unknown as { google?: MapsHandle }).google;
}

export function RouteMapCanvas({
  pins,
  lines,
  selectedKey,
  onSelect,
  mapConfigured,
  overlay,
  heightClass,
  fitKey,
}: {
  pins: MapPin[];
  lines: MapRouteLine[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** From the server page: whether a Maps key is configured at all. */
  mapConfigured: boolean;
  /** The selected stop's card, drawn over the map. */
  overlay?: React.ReactNode;
  heightClass: string;
  /** Changes when the day (or the visible set) changes: the map fits all pins again. */
  fitKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsHandle>(null);
  const pinOverlay = useRef<PinOverlay | null>(null);
  const polylines = useRef<MapsHandle[]>([]);
  const [state, setState] = useState<MapState>(mapConfigured ? "checking" : "not_configured");
  const [overlayReady, setOverlayReady] = useState(false);
  const [, setDrawCount] = useState(0);

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
    const map = new g.maps.Map(containerRef.current, {
      center: SYDNEY, zoom: 11, disableDefaultUI: true, zoomControl: true, gestureHandling: "cooperative", clickableIcons: false,
    });
    mapRef.current = map;
    pinOverlay.current = createPinOverlay(g, map, () => setDrawCount((count) => count + 1));
    setOverlayReady(true);
  }, [state]);

  useEffect(() => () => {
    polylines.current.forEach((line) => line.setMap(null));
    pinOverlay.current?.remove();
  }, []);

  // One polyline per route, in its colour and pattern, through its placed stops.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    const g = google();
    polylines.current.forEach((line) => line.setMap(null));
    polylines.current = lines
      .filter((line) => line.path.length >= 2)
      .map((line) => {
        const look = routeLook(line.lookIndex);
        const colour = resolveRouteColour(containerRef.current, look.colourToken);
        return new g.maps.Polyline({ ...polylineOptions(g, look.pattern, colour, line.path), map });
      });
  }, [state, lines]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pins.length === 0) {
      map.setCenter(SYDNEY);
      map.setZoom(11);
      return;
    }
    const bounds = new (google().maps.LatLngBounds)();
    pins.forEach((pin) => bounds.extend({ lat: pin.lat, lng: pin.lng }));
    map.fitBounds(bounds, 56);
    if (pins.length === 1) map.setZoom(14);
  }, [pins]);

  // A new day (or a new visible set) fits every pin once.
  useEffect(() => {
    if (state !== "ready" || !mapRef.current) return;
    fitAll();
    // Only when the day or the visible set changes, not on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, fitKey]);

  // Selecting a stop in the list pans the map to it.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map || !selectedKey) return;
    const pin = pins.find((item) => item.key === selectedKey);
    if (pin) map.panTo({ lat: pin.lat, lng: pin.lng });
    // Only when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedKey]);

  const ordered = useMemo(() => [...pins].sort((a, b) => Number(a.key === selectedKey) - Number(b.key === selectedKey)), [pins, selectedKey]);

  if (state === "not_configured") {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 p-6 text-center lg:min-h-[420px]" role="status">
        <p className="text-[0.9375rem] font-[600]">The map is not configured</p>
        <p className="max-w-sm text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          No Google Maps key is set (Settings › Integrations). The list has every stop, its times and the Google Maps links.
        </p>
        {overlay ? <div className="mt-2 w-full max-w-sm text-left">{overlay}</div> : null}
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 p-6 text-center lg:min-h-[420px]" role="alert">
        <p className="text-[0.9375rem] font-[600]">The map could not load</p>
        <p className="max-w-sm text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">The list still shows every stop and link. Reload the page to try the map again.</p>
        {overlay ? <div className="mt-2 w-full max-w-sm text-left">{overlay}</div> : null}
      </div>
    );
  }

  return (
    <div className="relative" role="region" aria-label="Map of the day's routes">
      {state !== "ready" ? <div className={`${heightClass} w-full animate-pulse bg-[hsl(var(--e-surface-raised))]`} role="status" aria-label="Loading the map" /> : null}
      <div ref={containerRef} className={`${heightClass} w-full ${state === "ready" ? "" : "hidden"}`} />
      {overlayReady && pinOverlay.current
        ? createPortal(
            <>
              {ordered.map((pin) => {
                const at = pinOverlay.current?.toPixel(pin.lat, pin.lng);
                if (!at) return null;
                return (
                  <div key={pin.key} className="absolute" style={{ left: at.x, top: at.y, zIndex: pin.key === selectedKey ? 30 : pin.look.colourToken ? 10 : 20, transform: `translate(-${PIN_HALF}px, -${PIN_HALF}px)` }}>
                    <RouteStopPin look={{ ...pin.look, selected: pin.key === selectedKey }} ariaLabel={pin.ariaLabel} onActivate={() => onSelect(pin.key)} />
                  </div>
                );
              })}
            </>,
            pinOverlay.current.container,
          )
        : null}
      {state === "ready" ? (
        <button type="button" onClick={fitAll} className="absolute right-3 top-3 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.94)] px-3 py-1.5 text-[0.75rem] font-[550] shadow-[var(--e-elevation-1)] hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] max-sm:min-h-11">
          <Crosshair className="h-3.5 w-3.5" aria-hidden /> Fit all
        </button>
      ) : null}
      {overlay ? <div className="pointer-events-none absolute bottom-3 left-3 w-[290px] max-w-[calc(100%-1.5rem)] [&>*]:pointer-events-auto">{overlay}</div> : null}
    </div>
  );
}
