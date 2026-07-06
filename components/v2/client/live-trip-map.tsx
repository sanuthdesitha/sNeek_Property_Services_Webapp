"use client";

/**
 * Estate live trip map — native v2 port of the legacy shared LiveTripMap.
 * Uses the shared Google Maps loader from lib (non-UI); everything visual is
 * styled through the Estate token scope.
 */
import { useEffect, useRef, useState } from "react";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import { cn } from "@/lib/utils";

export type ELiveTripMapProps = {
  cleanerLat: number | null;
  cleanerLng: number | null;
  propertyLat: number | null;
  propertyLng: number | null;
  heading?: number | null;
  className?: string;
};

export function ELiveTripMap({
  cleanerLat,
  cleanerLng,
  propertyLat,
  propertyLng,
  heading,
  className = "h-56",
}: ELiveTripMapProps) {
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
        fillColor: "#0f4c3a",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        rotation: heading ?? 0,
      };
      if (!cleanerMarkerRef.current) {
        cleanerMarkerRef.current = new google.maps.Marker({
          position: pos,
          map: mapRef.current,
          title: "Cleaner",
          icon,
          zIndex: 10,
        });
      } else {
        cleanerMarkerRef.current.setPosition(pos);
        cleanerMarkerRef.current.setIcon({ ...cleanerMarkerRef.current.getIcon(), rotation: heading ?? 0 });
      }
      mapRef.current.panTo(pos);
    }

    if (propertyLat != null && propertyLng != null && !propertyMarkerRef.current) {
      propertyMarkerRef.current = new google.maps.Marker({
        position: { lat: propertyLat, lng: propertyLng },
        map: mapRef.current,
        title: "Property",
      });
    }
  }, [mapReady, cleanerLat, cleanerLng, propertyLat, propertyLng, heading]);

  if (loadFailed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]",
          className
        )}
      >
        Live map unavailable right now.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]",
        className
      )}
    />
  );
}
