"use client";

import * as React from "react";
import { Loader } from "@googlemaps/js-api-loader";

export interface PropertyMarker {
  id: string;
  name: string;
  address: string;
  clientName: string;
  lat: number;
  lng: number;
  lastJobAt: string | null;
}

export function PropertiesMap({ properties }: { properties: PropertyMarker[] }) {
  const mapRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!mapRef.current || properties.length === 0) return;
    const node = mapRef.current;
    let mounted = true;

    (async () => {
      try {
        const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
          throw new Error("Google Maps API key not configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).");
        }
        const loader = new Loader({ apiKey, version: "weekly" });
        const google = (await loader.load()) as any;
        if (!mounted) return;

        const centerLat = properties.reduce((s, p) => s + p.lat, 0) / properties.length;
        const centerLng = properties.reduce((s, p) => s + p.lng, 0) / properties.length;

        const map = new google.maps.Map(node, {
          center: { lat: centerLat, lng: centerLng },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        const bounds = new google.maps.LatLngBounds();
        for (const p of properties) {
          const marker = new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.name,
          });
          bounds.extend(marker.getPosition());

          const lastJob = p.lastJobAt
            ? new Date(p.lastJobAt).toLocaleDateString()
            : "No jobs yet";
          const info = new google.maps.InfoWindow({
            content: `
              <div style="min-width:200px;font-family:system-ui,sans-serif">
                <div style="font-weight:600;margin-bottom:2px">${escapeHtml(p.name)}</div>
                <div style="font-size:12px;color:#6b7280">${escapeHtml(p.address)}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:2px">${escapeHtml(p.clientName)}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:4px">Last clean: ${escapeHtml(lastJob)}</div>
                <a href="/admin/properties/${p.id}" style="display:inline-block;margin-top:6px;font-size:12px;color:#2563eb;text-decoration:underline">View details</a>
              </div>
            `,
          });
          marker.addListener("click", () => info.open(map, marker));
        }
        if (properties.length > 1) {
          map.fitBounds(bounds);
        }
      } catch (e: any) {
        if (mounted) setError(e.message ?? "Could not load map.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, [properties]);

  if (properties.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No geolocated properties yet. Add addresses with autocomplete to populate the map.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Showing {properties.length}{" "}
        {properties.length === 1 ? "property" : "properties"} with geolocation.
      </p>
      {error && (
        <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <div ref={mapRef} className="h-[600px] w-full rounded-lg border border-border" />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
