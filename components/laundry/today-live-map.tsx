"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ExternalLink, LocateFixed, MapPin, Navigation, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import { buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";

export type RouteStop = {
  taskId: string;
  kind: "pickup" | "dropoff";
  propertyName: string;
  address: string | null;
  suburb: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  /** Scheduled time for this stop (pickupDate for pickups, dropoffDate for dropoffs). */
  scheduledAt: string;
  /** True once the stop's action has happened (picked up / dropped). */
  done: boolean;
};

const PICKUP_COLOR = "#0ea5e9"; // sky — pickups
const DROPOFF_COLOR = "#8b5cf6"; // violet — drop-offs
const DONE_COLOR = "#22c55e"; // green — completed stops

export function stopIsLate(stop: RouteStop, now: Date): boolean {
  if (stop.done) return false;
  if (stop.status === "DROPPED" || stop.status === "SKIPPED_PICKUP") return false;
  return new Date(stop.scheduledAt).getTime() < now.getTime();
}

/**
 * Sticky "you are here in the route" card: next stop + X of N progress bar.
 */
export function NextStopCard({ stops }: { stops: RouteStop[] }) {
  if (stops.length === 0) return null;
  const doneCount = stops.filter((s) => s.done).length;
  const next = stops.find((s) => !s.done);
  const pct = Math.round((doneCount / stops.length) * 100);

  return (
    <div className="sticky top-0 z-20 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Navigation className="size-4" />
          </span>
          {next ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                Next: {next.propertyName}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  ({next.kind === "pickup" ? "pickup" : "drop-off"}
                  {next.suburb ? ` · ${next.suburb}` : ""})
                </span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Stop {doneCount + 1} of {stops.length} · scheduled {format(new Date(next.scheduledAt), "HH:mm")}
              </p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-success">All {stops.length} stops done — route complete.</p>
          )}
        </div>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {doneCount}/{stops.length} done
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full bg-success transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * "Start route" live location sharing. While active, watches GPS
 * (high accuracy), throttles to one ping every ~20s or 50m of movement,
 * and POSTs to /api/laundry/location/ping so admin can follow the run.
 */
export function RouteShareControl() {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPingAt, setLastPingAt] = useState<Date | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ at: number; lat: number; lng: number } | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    lastSentRef.current = null;
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  const sendPing = useCallback(async (pos: GeolocationPosition) => {
    const { latitude, longitude, accuracy } = pos.coords;
    const last = lastSentRef.current;
    const now = Date.now();
    if (last) {
      const dtOk = now - last.at >= 20_000;
      // ~meters via equirectangular approximation — fine at city scale.
      const dLat = (latitude - last.lat) * 111_320;
      const dLng = (longitude - last.lng) * 111_320 * Math.cos((latitude * Math.PI) / 180);
      const distOk = Math.sqrt(dLat * dLat + dLng * dLng) >= 50;
      if (!dtOk && !distOk) return;
    }
    lastSentRef.current = { at: now, lat: latitude, lng: longitude };
    try {
      const res = await fetch("/api/laundry/location/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: latitude,
          lng: longitude,
          accuracy: accuracy ?? undefined,
          timestamp: new Date(pos.timestamp).toISOString(),
        }),
      });
      if (res.ok) setLastPingAt(new Date());
    } catch {
      // Transient network failure — next watch tick retries.
    }
  }, []);

  function startRoute() {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device does not support location sharing.");
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => void sendPing(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission denied — enable it in your browser settings to share your route.");
        } else {
          setError("Could not read your location. Check GPS and try again.");
        }
        stopWatch();
        setSharing(false);
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    setSharing(true);
  }

  function endRoute() {
    stopWatch();
    setSharing(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {sharing ? (
        <Button variant="outline" size="sm" onClick={endRoute} className="border-success/50 text-success">
          <Radio className="mr-1.5 size-3.5 animate-pulse" />
          Sharing live{lastPingAt ? ` · ${format(lastPingAt, "HH:mm:ss")}` : ""} — End route
        </Button>
      ) : (
        <Button size="sm" onClick={startRoute}>
          <LocateFixed className="mr-1.5 size-3.5" />
          Start route
        </Button>
      )}
      {error ? <p className="max-w-xs text-right text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function markerIcon(google: any, color: string) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 11,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
  };
}

/**
 * Today's route map: numbered pickup/drop pins in suggested visit order,
 * polyline through the stops, info windows, multi-stop Google Maps link,
 * "running late" indicators, and a list of stops without coordinates.
 */
export function TodayRouteMap({ stops }: { stops: RouteStop[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylineRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const now = useMemo(() => new Date(), []);

  const located = useMemo(
    () => stops.filter((s) => typeof s.lat === "number" && typeof s.lng === "number"),
    [stops],
  );
  const unlocated = useMemo(
    () => stops.filter((s) => typeof s.lat !== "number" || typeof s.lng !== "number"),
    [stops],
  );

  const mapsUrl = useMemo(
    () =>
      buildGoogleMapsMultiStopUrl(
        stops.map((s) => s.address ?? (s.suburb ? `${s.propertyName}, ${s.suburb}` : null)),
        { fromCurrentLocation: true },
      ),
    [stops],
  );

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
    if (!mapReady || !containerRef.current) return;
    const google = (window as any).google;

    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: { lat: -33.8688, lng: 151.2093 },
        zoom: 11,
        disableDefaultUI: true,
        zoomControl: true,
        fullscreenControl: true,
        gestureHandling: "greedy",
      });
    }
    const map = mapRef.current;

    // Clear previous render (stops re-derive on every data refresh).
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    const bounds = new google.maps.LatLngBounds();
    const path: Array<{ lat: number; lng: number }> = [];

    located.forEach((stop, index) => {
      const pos = { lat: stop.lat as number, lng: stop.lng as number };
      const color = stop.done ? DONE_COLOR : stop.kind === "pickup" ? PICKUP_COLOR : DROPOFF_COLOR;
      const late = stopIsLate(stop, now);
      const marker = new google.maps.Marker({
        position: pos,
        map,
        icon: markerIcon(google, color),
        label: { text: String(index + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
        title: `${index + 1}. ${stop.propertyName} — ${stop.kind === "pickup" ? "Pickup" : "Drop-off"}`,
        zIndex: stop.done ? 5 : 10,
      });
      const info = new google.maps.InfoWindow({
        content: `<div style="font:500 13px system-ui;color:#111;max-width:230px">
            ${index + 1}. ${stop.propertyName}
            <br/><span style="font-weight:400;color:#555">${stop.address ?? stop.suburb ?? ""}</span>
            <br/><span style="font-weight:600;color:${color}">${stop.kind === "pickup" ? "Pickup" : "Drop-off"}</span>
            · ${stop.status.replace(/_/g, " ")}
            ${late ? '<span style="color:#ef4444;font-weight:600"> · running late</span>' : ""}
            <br/><a href="/laundry?task=${stop.taskId}" style="color:#0e7490">Open in planner →</a>
          </div>`,
      });
      marker.addListener("click", () => info.open({ map, anchor: marker }));
      markersRef.current.push(marker);
      bounds.extend(pos);
      path.push(pos);
    });

    if (path.length > 1) {
      polylineRef.current = new google.maps.Polyline({
        path,
        map,
        strokeColor: "#0ea5e9",
        strokeOpacity: 0.75,
        strokeWeight: 3,
        geodesic: true,
      });
    }
    if (path.length > 0) map.fitBounds(bounds, 56);
  }, [mapReady, located, now]);

  if (stops.length === 0) return null;

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <MapPin className="size-4 text-primary" />
            Today&apos;s route
            <span className="text-sm font-normal text-muted-foreground tabular-nums">
              {located.length} mapped stop{located.length === 1 ? "" : "s"}
            </span>
          </CardTitle>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block size-2.5 rounded-full" style={{ background: PICKUP_COLOR }} /> Pickup
              <span className="ml-2 inline-block size-2.5 rounded-full" style={{ background: DROPOFF_COLOR }} /> Drop-off
              <span className="ml-2 inline-block size-2.5 rounded-full" style={{ background: DONE_COLOR }} /> Done
            </span>
            {mapsUrl ? (
              <Button variant="outline" size="sm" asChild>
                <a href={mapsUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 size-3.5" />
                  Open in Google Maps
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loadFailed ? (
          <p className="rounded-b-xl border-t-0 p-6 text-center text-sm text-muted-foreground">
            Map could not load — use &quot;Open in Google Maps&quot; instead.
          </p>
        ) : located.length === 0 ? (
          <p className="m-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            None of today&apos;s stops have saved coordinates yet — ask an admin to set property locations.
          </p>
        ) : (
          <div ref={containerRef} className="h-[320px] w-full rounded-b-xl sm:h-[400px]" />
        )}
        {unlocated.length > 0 ? (
          <div className="border-t border-border p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              No location on file ({unlocated.length})
            </p>
            <ul className="space-y-1">
              {unlocated.map((stop) => (
                <li key={`${stop.taskId}-${stop.kind}`} className="flex items-center gap-2 text-sm text-foreground">
                  <StatusPill variant={stop.kind === "pickup" ? "info" : "primary"} size="sm">
                    {stop.kind === "pickup" ? "Pickup" : "Drop-off"}
                  </StatusPill>
                  <span className="truncate">{stop.propertyName}</span>
                  <span className="text-xs text-muted-foreground">{stop.suburb ?? "No address"}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
