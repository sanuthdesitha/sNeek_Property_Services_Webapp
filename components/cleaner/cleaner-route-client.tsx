"use client";

import * as React from "react";
import Link from "next/link";
import {
  Navigation,
  MapPin,
  Clock,
  ExternalLink,
  RefreshCw,
  Loader2,
  Car,
  Train,
  Footprints,
  Bike,
  Locate,
  Copy,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { Badge } from "@/components/ui/badge";
import { AddressAutocomplete } from "@/components/ui/address-autocomplete";
import { loadMapsLibrary, loadMarkerLibrary } from "@/lib/google-maps/client";
import {
  getSequentialRoute,
  formatDistance,
  formatDuration,
  type TravelMode,
  type DistanceMatrixLeg,
} from "@/lib/google-maps/distance-matrix";

const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  EN_ROUTE: "On the way",
  IN_PROGRESS: "In Progress",
  PAUSED: "Paused",
  SUBMITTED: "Submitted",
  QA_REVIEW: "Under Review",
  COMPLETED: "Completed",
};

const STATUS_VARIANT: Record<string, "neutral" | "info" | "success" | "warning" | "danger" | "primary"> = {
  EN_ROUTE: "warning",
  IN_PROGRESS: "primary",
  COMPLETED: "success",
  PAUSED: "warning",
  SUBMITTED: "info",
  QA_REVIEW: "info",
};

interface Stop {
  jobId: string;
  jobNumber: number | string | null;
  jobType?: string;
  status: string;
  startTime: string | null;
  dueTime?: string | null;
  enRouteEtaMinutes?: number | null;
  arrivedAt?: string | null;
  propertyName: string;
  address: string;
  suburb: string;
  state?: string | null;
  postcode?: string | null;
  latitude: number | null;
  longitude: number | null;
}

type RouteMode = "today" | "tomorrow" | "date";

export interface CleanerRouteClientProps {
  initialDate: string; // YYYY-MM-DD (today, in Australia/Sydney)
  initialStops: Stop[];
}

function isoToday(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function travelModeLabel(mode: TravelMode) {
  return (
    {
      DRIVING: "Driving",
      TRANSIT: "Public transit",
      WALKING: "Walking",
      BICYCLING: "Biking",
    } as const
  )[mode];
}

function travelModeIcon(mode: TravelMode) {
  switch (mode) {
    case "TRANSIT":
      return Train;
    case "WALKING":
      return Footprints;
    case "BICYCLING":
      return Bike;
    case "DRIVING":
    default:
      return Car;
  }
}

function buildFullRouteUrl(
  stops: Stop[],
  travelMode: TravelMode,
  from?: { lat: number; lng: number } | null
): string | null {
  const addresses = stops
    .filter((s) => s.address)
    .map((s) =>
      [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(", ")
    );
  if (addresses.length === 0) return null;
  const params = new URLSearchParams({
    api: "1",
    travelmode: travelMode.toLowerCase(),
  });
  if (from) params.set("origin", `${from.lat},${from.lng}`);
  params.set("destination", addresses[addresses.length - 1]);
  const wp = addresses.slice(0, -1);
  if (wp.length > 0) params.set("waypoints", wp.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildLegUrl(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  travelMode: TravelMode
): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${travelMode.toLowerCase()}`;
}

export function CleanerRouteClient({
  initialDate,
  initialStops,
}: CleanerRouteClientProps) {
  const [stops, setStops] = React.useState<Stop[]>(initialStops);
  const [routeMode, setRouteMode] = React.useState<RouteMode>("today");
  const [selectedDate, setSelectedDate] = React.useState(initialDate);
  const [travelMode, setTravelMode] = React.useState<TravelMode>("DRIVING");
  const [currentLocation, setCurrentLocation] = React.useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locError, setLocError] = React.useState<string | null>(null);
  const [startOverride, setStartOverride] = React.useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);
  const [legs, setLegs] = React.useState<DistanceMatrixLeg[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [legsLoading, setLegsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mapError, setMapError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const mapRef = React.useRef<HTMLDivElement>(null);
  const mapInstanceRef = React.useRef<any>(null);
  const markersRef = React.useRef<any[]>([]);
  const polylineRef = React.useRef<any>(null);
  const currentMarkerRef = React.useRef<any>(null);
  const startMarkerRef = React.useRef<any>(null);
  const infoWindowRef = React.useRef<any>(null);

  // ------------------------------------------------------------------
  // Data fetch
  // ------------------------------------------------------------------
  const fetchStops = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (routeMode === "tomorrow") params.set("relative", "tomorrow");
      else if (routeMode === "date") params.set("date", selectedDate);
      const url = `/api/cleaner/today-route${
        params.toString() ? `?${params.toString()}` : ""
      }`;
      const res = await fetch(url, {
        cache: "no-store",
        headers: { "x-progress-toast": "off" },
      });
      if (!res.ok) throw new Error("Could not load route");
      const data = await res.json();
      setStops(Array.isArray(data.stops) ? data.stops : []);
    } catch (err: any) {
      setError(err?.message ?? "Could not load route");
    } finally {
      setLoading(false);
    }
  }, [routeMode, selectedDate]);

  // Refetch on mode/date change (but skip the initial paint — we already have SSR data).
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    fetchStops();
  }, [fetchStops]);

  // ------------------------------------------------------------------
  // Current GPS (watchPosition)
  // ------------------------------------------------------------------
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocError("Geolocation not supported on this device.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocError(null);
      },
      (err) => setLocError(err.message || "Could not get location"),
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // ------------------------------------------------------------------
  // Map init (once)
  // ------------------------------------------------------------------
  React.useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const maps: any = await loadMapsLibrary();
        await loadMarkerLibrary().catch(() => null);
        if (cancelled || !mapRef.current) return;
        const { Map } = maps;
        const initialCenter =
          stops.find((s) => s.latitude != null && s.longitude != null) ?? null;
        mapInstanceRef.current = new Map(mapRef.current, {
          zoom: 11,
          center: initialCenter
            ? { lat: initialCenter.latitude!, lng: initialCenter.longitude! }
            : { lat: -33.8688, lng: 151.2093 }, // Sydney CBD fallback
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        const g: any = (window as any).google;
        infoWindowRef.current = new g.maps.InfoWindow();
      } catch (err: any) {
        if (!cancelled) {
          setMapError(
            err?.message ??
              "Map failed to load — check NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and that the Maps JavaScript + Distance Matrix APIs are enabled."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Render stop markers + polyline whenever stops/start change
  // ------------------------------------------------------------------
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const g: any = (window as any).google;
    if (!g?.maps) return;

    // Clear old markers / polyline
    markersRef.current.forEach((m) => {
      try {
        m.setMap(null);
      } catch {
        /* noop */
      }
    });
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    const stopsWithCoords = stops.filter(
      (s) => s.latitude != null && s.longitude != null
    );
    const bounds = new g.maps.LatLngBounds();
    let bounded = false;

    stopsWithCoords.forEach((s, i) => {
      const marker = new g.maps.Marker({
        position: { lat: s.latitude!, lng: s.longitude! },
        map,
        label: {
          text: String(i + 1),
          color: "#fff",
          fontWeight: "700",
          fontSize: "12px",
        },
        title: `${i + 1}. ${s.propertyName}`,
      });
      marker.addListener("click", () => {
        const arrival = s.startTime ? `Arrive ${s.startTime}` : "";
        infoWindowRef.current?.setContent(
          `<div style="max-width:220px"><strong>${i + 1}. ${escapeHtml(
            s.propertyName
          )}</strong><br/><span style="color:#666">${escapeHtml(
            [s.address, s.suburb].filter(Boolean).join(", ")
          )}</span>${arrival ? `<br/><span style="color:#0E7C9A">${arrival}</span>` : ""}</div>`
        );
        infoWindowRef.current?.open(map, marker);
      });
      markersRef.current.push(marker);
      bounds.extend(marker.getPosition()!);
      bounded = true;
    });

    if (currentLocation) {
      bounds.extend(
        new g.maps.LatLng(currentLocation.lat, currentLocation.lng)
      );
      bounded = true;
    }
    if (startOverride) {
      bounds.extend(new g.maps.LatLng(startOverride.lat, startOverride.lng));
      bounded = true;
    }

    if (bounded) {
      if (stopsWithCoords.length === 1 && !currentLocation && !startOverride) {
        // Single point — center + zoom
        map.setCenter({
          lat: stopsWithCoords[0].latitude!,
          lng: stopsWithCoords[0].longitude!,
        });
        map.setZoom(14);
      } else {
        map.fitBounds(bounds, 60);
      }
    }

    // Polyline connecting stops in scheduled order (prepend start if known)
    const start = startOverride ?? currentLocation;
    const path: Array<{ lat: number; lng: number }> = [];
    if (start) path.push({ lat: start.lat, lng: start.lng });
    stopsWithCoords.forEach((s) =>
      path.push({ lat: s.latitude!, lng: s.longitude! })
    );
    if (path.length >= 2) {
      polylineRef.current = new g.maps.Polyline({
        path,
        strokeColor: "#0E7C9A",
        strokeWeight: 3,
        strokeOpacity: 0.75,
        map,
        geodesic: true,
      });
    }
  }, [stops, currentLocation, startOverride]);

  // Current location marker
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !currentLocation) return;
    const g: any = (window as any).google;
    if (!g?.maps) return;
    if (currentMarkerRef.current) {
      currentMarkerRef.current.setPosition({
        lat: currentLocation.lat,
        lng: currentLocation.lng,
      });
    } else {
      currentMarkerRef.current = new g.maps.Marker({
        position: { lat: currentLocation.lat, lng: currentLocation.lng },
        map,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#F58A0C",
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#FFFFFF",
        },
        title: "You are here",
        zIndex: 999,
      });
    }
  }, [currentLocation]);

  // Start override marker
  React.useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const g: any = (window as any).google;
    if (!g?.maps) return;
    if (startMarkerRef.current) {
      startMarkerRef.current.setMap(null);
      startMarkerRef.current = null;
    }
    if (startOverride) {
      startMarkerRef.current = new g.maps.Marker({
        position: { lat: startOverride.lat, lng: startOverride.lng },
        map,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: "#0E7C9A",
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#FFFFFF",
        },
        title: `Start: ${startOverride.label}`,
        zIndex: 998,
      });
    }
  }, [startOverride]);

  // ------------------------------------------------------------------
  // Distance Matrix legs whenever stops/travelMode/start change
  // ------------------------------------------------------------------
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const stopsWithCoords = stops.filter(
        (s) => s.latitude != null && s.longitude != null
      );
      const start = startOverride ?? currentLocation;
      const waypoints: Array<{ lat: number; lng: number }> = [];
      if (start) waypoints.push({ lat: start.lat, lng: start.lng });
      stopsWithCoords.forEach((s) =>
        waypoints.push({ lat: s.latitude!, lng: s.longitude! })
      );
      if (waypoints.length < 2) {
        setLegs([]);
        return;
      }
      setLegsLoading(true);
      try {
        const computed = await getSequentialRoute(waypoints, travelMode);
        if (!cancelled) setLegs(computed);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[Route] distance matrix failed", err);
        if (!cancelled) setLegs([]);
      } finally {
        if (!cancelled) setLegsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stops, currentLocation, startOverride, travelMode]);

  // ------------------------------------------------------------------
  // Derived
  // ------------------------------------------------------------------
  const startPoint = startOverride ?? currentLocation;
  const fullRouteUrl = React.useMemo(
    () => buildFullRouteUrl(stops, travelMode, startPoint),
    [stops, travelMode, startPoint]
  );
  const stopsWithCoords = stops.filter(
    (s) => s.latitude != null && s.longitude != null
  );
  const stopsMissingCoords = stops.length - stopsWithCoords.length;
  const hasStartLeg = Boolean(startPoint);
  // legs[0] = start → stop[0] (if startPoint), else legs[0] = stop[0] → stop[1]
  function legForStop(i: number) {
    if (hasStartLeg) return legs[i] ?? null; // 0..N-1
    if (i === 0) return null;
    return legs[i - 1] ?? null;
  }
  const totalDistance = legs.reduce((s, l) => s + l.distanceMeters, 0);
  const totalDuration = legs.reduce((s, l) => s + l.durationSeconds, 0);

  async function handleCopyRoute() {
    if (!fullRouteUrl) return;
    try {
      await navigator.clipboard.writeText(fullRouteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  const TravelIcon = travelModeIcon(travelMode);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={routeMode === "today" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setRouteMode("today");
                setSelectedDate(isoToday(0));
              }}
            >
              Today
            </Button>
            <Button
              variant={routeMode === "tomorrow" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setRouteMode("tomorrow");
                setSelectedDate(isoToday(1));
              }}
            >
              Tomorrow
            </Button>
            <Button
              variant={routeMode === "date" ? "default" : "outline"}
              size="sm"
              onClick={() => setRouteMode("date")}
            >
              Specific date
            </Button>
            {routeMode === "date" ? (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-9 rounded-md border border-border-strong bg-surface px-3 text-sm"
              />
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStops}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Travel mode
              </label>
              <Select
                value={travelMode}
                onValueChange={(v) => setTravelMode(v as TravelMode)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRIVING">
                    <span className="flex items-center gap-2">
                      <Car className="h-4 w-4" /> Driving
                    </span>
                  </SelectItem>
                  <SelectItem value="TRANSIT">
                    <span className="flex items-center gap-2">
                      <Train className="h-4 w-4" /> Public transit
                    </span>
                  </SelectItem>
                  <SelectItem value="WALKING">
                    <span className="flex items-center gap-2">
                      <Footprints className="h-4 w-4" /> Walking
                    </span>
                  </SelectItem>
                  <SelectItem value="BICYCLING">
                    <span className="flex items-center gap-2">
                      <Bike className="h-4 w-4" /> Biking
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Start from
              </label>
              <div className="mt-1">
                <AddressAutocomplete
                  placeholder={
                    currentLocation
                      ? "Using current GPS — type to override"
                      : "Pick a start address"
                  }
                  onSelect={(r) =>
                    setStartOverride({
                      lat: r.lat,
                      lng: r.lng,
                      label: r.formattedAddress,
                    })
                  }
                />
              </div>
              {startOverride ? (
                <button
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline"
                  onClick={() => setStartOverride(null)}
                >
                  <Locate className="h-3 w-3" /> Reset to GPS
                </button>
              ) : currentLocation ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Live GPS active
                </p>
              ) : locError ? (
                <p className="mt-1 text-[11px] text-warning">
                  GPS unavailable: {locError}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Locating…
                </p>
              )}
            </div>
          </div>

          {/* Summary + full-route link */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <TravelIcon className="h-3.5 w-3.5" />
                {travelModeLabel(travelMode)}
              </span>
              <span>
                {stopsWithCoords.length}{" "}
                {stopsWithCoords.length === 1 ? "stop" : "stops"}
              </span>
              {legs.length > 0 && (
                <>
                  <span className="font-mono">{formatDistance(totalDistance)} total</span>
                  <span className="font-mono">
                    {formatDuration(totalDuration)} travel
                  </span>
                </>
              )}
              {legsLoading && (
                <Loader2 className="h-3 w-3 animate-spin" aria-label="Calculating" />
              )}
            </div>
            <div className="flex gap-2">
              {fullRouteUrl && (
                <>
                  <Button variant="outline" size="sm" onClick={handleCopyRoute}>
                    {copied ? (
                      <Check className="mr-2 h-4 w-4 text-success" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <Button asChild size="sm">
                    <a href={fullRouteUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open all in Maps
                    </a>
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Map */}
      <Card>
        <CardContent className="p-0">
          {mapError ? (
            <div className="flex h-[400px] items-center justify-center bg-muted p-6 text-center text-sm text-muted-foreground md:h-[500px]">
              {mapError}
            </div>
          ) : (
            <div
              ref={mapRef}
              className="h-[400px] w-full rounded-lg bg-muted md:h-[500px]"
            />
          )}
        </CardContent>
      </Card>

      {/* Errors / coverage notes */}
      {error && (
        <Card>
          <CardContent className="py-4 text-center text-sm text-warning">
            {error}
          </CardContent>
        </Card>
      )}
      {stopsMissingCoords > 0 && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="p-3 text-xs text-foreground">
            {stopsMissingCoords} stop{stopsMissingCoords === 1 ? "" : "s"} on
            this day {stopsMissingCoords === 1 ? "is" : "are"} missing
            coordinates and won&apos;t appear on the map. (Property latitude /
            longitude isn&apos;t set — backfill needed.)
          </CardContent>
        </Card>
      )}

      {/* Stops list */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {stops.length} {stops.length === 1 ? "stop" : "stops"} scheduled
        </h2>
        {loading && stops.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading route…
            </CardContent>
          </Card>
        ) : stops.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No jobs scheduled for this date — no driving today.
          </div>
        ) : (
          stops.map((s, i) => {
            const leg = legForStop(i);
            const stopHasCoords = s.latitude != null && s.longitude != null;
            // Source coords for the "Directions" deep link
            const legFrom: { lat: number; lng: number } | null =
              i === 0
                ? startPoint
                : stops[i - 1].latitude != null &&
                  stops[i - 1].longitude != null
                ? {
                    lat: stops[i - 1].latitude!,
                    lng: stops[i - 1].longitude!,
                  }
                : startPoint;
            return (
              <Card
                key={s.jobId}
                className={
                  s.status === "EN_ROUTE"
                    ? "border-warning/40 bg-warning/10"
                    : ""
                }
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <CardTitle className="text-sm font-semibold">
                        {s.propertyName}
                      </CardTitle>
                      <StatusPill variant={STATUS_VARIANT[s.status] ?? "neutral"}>
                        {STATUS_LABELS[s.status] ?? s.status}
                      </StatusPill>
                      {!stopHasCoords && (
                        <Badge variant="outline" className="text-[10px]">
                          No coords
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {[s.address, s.suburb, s.state, s.postcode]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {s.startTime && s.dueTime
                        ? `${s.startTime} – ${s.dueTime}`
                        : s.startTime || s.dueTime || "No time set"}
                    </span>
                    {s.jobType && (
                      <span>{s.jobType.replace(/_/g, " ").toLowerCase()}</span>
                    )}
                    {leg && leg.distanceMeters > 0 && (
                      <span className="flex items-center gap-1 font-mono text-primary">
                        <TravelIcon className="h-3.5 w-3.5" />
                        {formatDistance(leg.distanceMeters)} ·{" "}
                        {formatDuration(leg.durationSeconds)}
                        {i === 0 && hasStartLeg ? " from start" : i > 0 ? " from prev" : ""}
                      </span>
                    )}
                    {leg && leg.status === "ERROR" && (
                      <span className="text-warning">leg unavailable</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {stopHasCoords && legFrom && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          window.open(
                            buildLegUrl(
                              legFrom,
                              { lat: s.latitude!, lng: s.longitude! },
                              travelMode
                            ),
                            "_blank"
                          )
                        }
                      >
                        <Navigation className="mr-1.5 h-3.5 w-3.5" />
                        Directions
                      </Button>
                    )}
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/cleaner/jobs/${s.jobId}`}>Open job</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
