"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, LogIn, LogOut, ExternalLink } from "lucide-react";
import { ensureGoogleMaps } from "@/lib/maps/loader";

type Point = { lat: number; lng: number; at?: string | null; accuracy?: number | null };

interface ClockLocationsMapProps {
  property?: { lat?: number | null; lng?: number | null; name?: string | null } | null;
  checkIn?: Point | null;
  checkOut?: Point | null;
  distanceMeters?: number | null;
  className?: string;
}

function fmtTime(at?: string | null) {
  if (!at) return null;
  try {
    return new Date(at).toLocaleString();
  } catch {
    return null;
  }
}

function pinSvg(color: string) {
  return {
    path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
    fillColor: color,
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: 2,
    scale: 1.6,
    anchor: { x: 12, y: 22 } as any,
  };
}

/**
 * Shows the cleaner's clock-in and clock-out GPS positions (and the property
 * location) on an embedded Google map. Falls back to "open in Google Maps"
 * links when no maps key is configured, so it always shows something useful.
 */
export function ClockLocationsMap({
  property,
  checkIn,
  checkOut,
  distanceMeters,
  className = "",
}: ClockLocationsMapProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const propPoint =
    property && Number.isFinite(Number(property.lat)) && Number.isFinite(Number(property.lng))
      ? { lat: Number(property.lat), lng: Number(property.lng) }
      : null;
  const hasAny = Boolean(checkIn || checkOut || propPoint);

  useEffect(() => {
    if (!hasAny) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureGoogleMaps();
        const w = window as any;
        if (cancelled || !ref.current || !w.google?.maps?.Map) {
          if (!w.google?.maps?.Map) setFailed(true);
          return;
        }
        const g = w.google.maps;
        const map = new g.Map(ref.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoom: 15,
          center: checkIn ?? checkOut ?? propPoint ?? { lat: 0, lng: 0 },
        });
        const bounds = new g.LatLngBounds();
        const addMarker = (p: Point | { lat: number; lng: number }, title: string, color: string) => {
          const pos = { lat: p.lat, lng: p.lng };
          new g.Marker({ position: pos, map, title, icon: pinSvg(color) });
          bounds.extend(pos);
        };
        if (propPoint) addMarker(propPoint, property?.name || "Property", "#117888");
        if (checkIn) addMarker(checkIn, "Clock-in", "#16a34a");
        if (checkOut) addMarker(checkOut, "Clock-out", "#dc2626");
        if (checkIn && checkOut) {
          new g.Polyline({
            map,
            path: [checkIn, checkOut],
            strokeColor: "#64748b",
            strokeOpacity: 0.7,
            strokeWeight: 2,
          });
        }
        // Fit to all points (or keep zoom for a single point).
        const pts = [propPoint, checkIn, checkOut].filter(Boolean);
        if (pts.length > 1) {
          map.fitBounds(bounds, 48);
        }
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAny, checkIn?.lat, checkIn?.lng, checkOut?.lat, checkOut?.lng, propPoint?.lat, propPoint?.lng]);

  if (!hasAny) {
    return <p className={`text-xs text-muted-foreground ${className}`}>No GPS clock-in/out recorded for this job yet.</p>;
  }

  const gmaps = (p: Point | { lat: number; lng: number }) =>
    `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

  return (
    <div className={className}>
      {!failed ? (
        <div ref={ref} className="h-56 w-full overflow-hidden rounded-lg border border-border bg-muted/30" />
      ) : (
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Map unavailable (no Google Maps key). Use the links below to view the locations.
        </p>
      )}
      <div className="mt-2 grid gap-1.5 text-xs">
        {checkIn ? (
          <a href={gmaps(checkIn)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-emerald-600 hover:underline">
            <LogIn className="h-3.5 w-3.5" /> Clock-in
            {fmtTime(checkIn.at) ? <span className="text-muted-foreground">· {fmtTime(checkIn.at)}</span> : null}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
        ) : null}
        {checkOut ? (
          <a href={gmaps(checkOut)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-red-600 hover:underline">
            <LogOut className="h-3.5 w-3.5" /> Clock-out
            {fmtTime(checkOut.at) ? <span className="text-muted-foreground">· {fmtTime(checkOut.at)}</span> : null}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
        ) : null}
        {propPoint ? (
          <a href={gmaps(propPoint)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
            <MapPin className="h-3.5 w-3.5" /> {property?.name || "Property"}
            <ExternalLink className="h-3 w-3 opacity-60" />
          </a>
        ) : null}
        {typeof distanceMeters === "number" && Number.isFinite(distanceMeters) ? (
          <p className="text-muted-foreground">
            Clock-in was {distanceMeters < 1000 ? `${Math.round(distanceMeters)} m` : `${(distanceMeters / 1000).toFixed(1)} km`} from the property.
          </p>
        ) : null}
      </div>
      {ready ? null : null}
    </div>
  );
}
