"use client";

import { useEffect, useRef, useState } from "react";
import { ensureGoogleMaps } from "@/lib/maps/loader";

export type LiveTripMapProps = {
  cleanerLat: number | null;
  cleanerLng: number | null;
  propertyLat: number | null;
  propertyLng: number | null;
  heading?: number | null;
  className?: string;
};

export function LiveTripMap({ cleanerLat, cleanerLng, propertyLat, propertyLng, heading, className = "h-56" }: LiveTripMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const cleanerMarkerRef = useRef<any>(null);
  const propertyMarkerRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

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
    if (!google?.maps?.Map) return;

    const center =
      cleanerLat != null && cleanerLng != null
        ? { lat: cleanerLat, lng: cleanerLng }
        : propertyLat != null && propertyLng != null
        ? { lat: propertyLat, lng: propertyLng }
        : { lat: -33.8688, lng: 151.2093 };

    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(containerRef.current, {
        center,
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "cooperative",
      });
    }

    if (cleanerLat != null && cleanerLng != null) {
      const pos = { lat: cleanerLat, lng: cleanerLng };
      const icon = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 6,
        fillColor: "#2563eb",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        rotation: heading ?? 0,
      };
      if (!cleanerMarkerRef.current) {
        cleanerMarkerRef.current = new google.maps.Marker({ position: pos, map: mapRef.current, title: "Cleaner", icon, zIndex: 10 });
      } else {
        cleanerMarkerRef.current.setPosition(pos);
        cleanerMarkerRef.current.setIcon({ ...cleanerMarkerRef.current.getIcon(), rotation: heading ?? 0 });
      }
    }

    if (propertyLat != null && propertyLng != null && !propertyMarkerRef.current) {
      propertyMarkerRef.current = new google.maps.Marker({
        position: { lat: propertyLat, lng: propertyLng },
        map: mapRef.current,
        title: "Property",
      });
    }

    if (cleanerLat != null && cleanerLng != null && propertyLat != null && propertyLng != null) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: cleanerLat, lng: cleanerLng });
      bounds.extend({ lat: propertyLat, lng: propertyLng });
      mapRef.current.fitBounds(bounds, 48);
    } else {
      mapRef.current.setView?.(center, 14);
    }
  }, [mapReady, cleanerLat, cleanerLng, propertyLat, propertyLng, heading]);

  if (loadFailed) {
    return (
      <div className={`${className} flex w-full items-center justify-center rounded-xl border bg-muted px-4 text-center text-xs text-muted-foreground`}>
        Live map unavailable. Configure a valid Google Maps API key to render cleaner locations.
      </div>
    );
  }
  if (!mapReady) return <div className={`${className} w-full rounded-xl border bg-muted animate-pulse`} />;
  return <div ref={containerRef} className={`${className} w-full rounded-xl overflow-hidden border`} />;
}
