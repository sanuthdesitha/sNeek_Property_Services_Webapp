"use client";

/**
 * Office map of where the laundry drivers are: one marker per driver with an
 * ACTIVE route today, coloured by the age of their last fix (the one policy in
 * lib/gps/staleness), an accuracy ring, a hollow "approximate" style for a
 * coarse fix, and the selected driver's route stops in order. Presentational:
 * the Live tab polls /api/admin/laundry/live and hands the drivers in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import { FRESHNESS_TIERS, freshnessTier, isApproximateFix } from "@/lib/gps/staleness";

export type OfficeDriverStop = {
  taskId: string;
  kind: "PICKUP" | "DROP";
  order: number;
  propertyName: string;
  suburb: string | null;
  lat: number | null;
  lng: number | null;
  arrivedAt: string | null;
  completedAt: string | null;
};

export type OfficeDriver = {
  userId: string;
  routeId: string;
  user: { id: string; name: string | null };
  phone: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  timestamp: string | null;
  trackingState: string | null;
  trackingStateAt: string | null;
  stopsDone: number;
  stopsTotal: number;
  stops: OfficeDriverStop[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type MapsHandle = any;

const MAP_HEIGHT = "h-[300px] sm:h-[420px]";

function google(): MapsHandle {
  return (window as unknown as { google?: MapsHandle }).google;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function LaundryDriverMap({
  drivers,
  selectedUserId,
  onSelect,
}: {
  drivers: OfficeDriver[];
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsHandle>(null);
  const markers = useRef<Map<string, MapsHandle>>(new Map());
  const rings = useRef<Map<string, MapsHandle>>(new Map());
  const stopMarkers = useRef<MapsHandle[]>([]);
  const routeLine = useRef<MapsHandle>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    ensureGoogleMaps()
      .then(() => (google()?.maps?.Map ? setReady(true) : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    mapRef.current = new (google().maps.Map)(containerRef.current, {
      center: { lat: -33.8688, lng: 151.2093 }, zoom: 11, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: "greedy",
    });
  }, [ready]);

  const select = useCallback((userId: string) => onSelect(userId), [onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const g = google();
    const seen = new Set<string>();
    for (const driver of drivers) {
      if (driver.lat == null || driver.lng == null) continue;
      seen.add(driver.userId);
      const tier = freshnessTier(driver.timestamp);
      const approximate = isApproximateFix(driver.accuracy);
      const selected = driver.userId === selectedUserId;
      const icon = {
        path: g.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: selected ? 8 : 6,
        fillColor: tier.color, fillOpacity: approximate ? 0.3 : 1,
        strokeColor: selected ? "#1f3d33" : approximate ? tier.color : "#ffffff", strokeWeight: 2,
        labelOrigin: new g.maps.Point(0, -3),
      };
      const position = { lat: driver.lat, lng: driver.lng };
      const title = `${driver.user.name ?? "Driver"} — stop ${Math.min(driver.stopsDone + 1, driver.stopsTotal)} of ${driver.stopsTotal}${approximate ? " · approximate position" : ""}`;
      const existing = markers.current.get(driver.userId);
      if (existing) {
        existing.setPosition(position);
        existing.setIcon(icon);
        existing.setTitle(title);
      } else {
        const marker = new g.maps.Marker({ position, map, icon, title, label: { text: driver.user.name ?? "Driver", fontSize: "11px", fontWeight: "600", color: "#2a241d" }, zIndex: 20 });
        marker.addListener("click", () => select(driver.userId));
        markers.current.set(driver.userId, marker);
      }
      if (driver.accuracy != null && driver.accuracy > 0) {
        const options = { center: position, radius: Math.min(driver.accuracy, 5_000), strokeColor: tier.color, strokeOpacity: 0.55, strokeWeight: 1, fillColor: tier.color, fillOpacity: 0.08, clickable: false };
        const ring = rings.current.get(driver.userId);
        if (ring) ring.setOptions(options);
        else rings.current.set(driver.userId, new g.maps.Circle({ ...options, map }));
      } else {
        rings.current.get(driver.userId)?.setMap(null);
        rings.current.delete(driver.userId);
      }
    }
    markers.current.forEach((marker, key) => {
      if (!seen.has(key)) { marker.setMap(null); markers.current.delete(key); }
    });
    rings.current.forEach((ring, key) => {
      if (!seen.has(key)) { ring.setMap(null); rings.current.delete(key); }
    });
    if (!fitted.current && seen.size > 0) {
      const bounds = new g.maps.LatLngBounds();
      drivers.forEach((d) => { if (d.lat != null && d.lng != null) bounds.extend({ lat: d.lat, lng: d.lng }); });
      map.fitBounds(bounds, 56);
      fitted.current = true;
    }
  }, [ready, drivers, selectedUserId, select]);

  // The selected driver's route: numbered stops (done ones dimmed) and a line.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const g = google();
    stopMarkers.current.forEach((marker) => marker.setMap(null));
    stopMarkers.current = [];
    routeLine.current?.setMap(null);
    routeLine.current = null;
    const driver = drivers.find((d) => d.userId === selectedUserId);
    if (!driver) return;
    const located = driver.stops.filter((stop) => stop.lat != null && stop.lng != null).sort((a, b) => a.order - b.order);
    located.forEach((stop, index) => {
      const done = Boolean(stop.completedAt);
      const marker = new g.maps.Marker({
        position: { lat: stop.lat, lng: stop.lng }, map, zIndex: 10,
        title: `${index + 1}. ${stop.kind === "PICKUP" ? "Pickup" : "Drop-off"} · ${stop.propertyName}${done ? " · done" : stop.arrivedAt ? " · arrived" : ""}`,
        label: { text: String(index + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 10, fillColor: done ? "#8a7f70" : stop.kind === "PICKUP" ? "#0ea5e9" : "#8b5cf6", fillOpacity: done ? 0.55 : 1, strokeColor: "#ffffff", strokeWeight: 2 },
      });
      const info = new g.maps.InfoWindow({ content: `<div style="font:500 13px system-ui;color:#2a241d">${escapeHtml(stop.propertyName)}<br/><span style="font-weight:400;color:#8a7f70">${stop.kind === "PICKUP" ? "Pickup" : "Drop-off"}${stop.suburb ? ` · ${escapeHtml(stop.suburb)}` : ""}</span></div>` });
      marker.addListener("click", () => info.open({ map, anchor: marker }));
      stopMarkers.current.push(marker);
    });
    if (located.length > 1) {
      routeLine.current = new g.maps.Polyline({ map, path: located.map((stop) => ({ lat: stop.lat, lng: stop.lng })), strokeColor: "#7a6f2e", strokeOpacity: 0.6, strokeWeight: 3, clickable: false });
    }
  }, [ready, drivers, selectedUserId]);

  if (failed) {
    return (
      <p className="p-4 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        Map unavailable — check the Google Maps API key in System → Integrations. The driver list still updates.
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="relative" role="region" aria-label="Map of laundry driver positions">
        {!ready ? <div className={`${MAP_HEIGHT} w-full animate-pulse bg-[hsl(var(--e-surface-raised))]`} /> : null}
        <div ref={containerRef} className={`${MAP_HEIGHT} w-full ${ready ? "" : "hidden"}`} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        {FRESHNESS_TIERS.map((tier) => (
          <span key={tier.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full ring-1 ring-white" style={{ backgroundColor: tier.color }} aria-hidden />{tier.label}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-[#3f9b6d] bg-[#3f9b6d]/25" aria-hidden />Approximate · ring shows accuracy</span>
      </div>
    </div>
  );
}
