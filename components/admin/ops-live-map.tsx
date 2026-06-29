"use client";

import { useEffect, useRef, useState } from "react";
import { ensureGoogleMaps } from "@/lib/maps/loader";

export interface PropertyMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface CleanerLocation {
  userId: string;
  name: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  lastSeenAt: string;
}

interface RawPing {
  userId: string;
  user?: { name?: string | null } | null;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
}

/**
 * Real-time visual operations map: plots every geocoded property as a teal
 * dot and overlays each cleaner's most-recent GPS ping as an orange arrow.
 * Streams updates from /api/admin/ops/live-locations/stream via EventSource.
 *
 * Properties are loaded server-side and passed in via props; cleaner markers
 * are seeded from /api/admin/ops/live-locations on mount and then updated
 * incrementally as pings stream in.
 */
export function OpsLiveMap({
  initialProperties,
}: {
  initialProperties: PropertyMarker[];
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<{ map: any; google: any } | null>(null);
  const cleanerMarkersRef = useRef<Map<string, any>>(new Map());
  const propertyMarkersRef = useRef<any[]>([]);
  const [cleaners, setCleaners] = useState<Map<string, CleanerLocation>>(
    new Map(),
  );
  const [mapError, setMapError] = useState<string | null>(null);

  // ── Initialize Google Map + property markers ───────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        // Resolve the key at runtime via /api/public/maps-config (works in
        // production where NEXT_PUBLIC_* build-time env vars are not inlined
        // into client bundles). ensureGoogleMaps injects the script once.
        await ensureGoogleMaps();
        const google = (window as any).google;
        if (!google?.maps?.Map) {
          setMapError("Google Maps key not configured — set it in Settings → Integrations.");
          return;
        }
        if (cancelled || !mapRef.current) return;

        // Default to Sydney center; refine via bounds when properties exist.
        const centerLat =
          initialProperties.length > 0
            ? initialProperties.reduce((s, p) => s + p.lat, 0) / initialProperties.length
            : -33.8688;
        const centerLng =
          initialProperties.length > 0
            ? initialProperties.reduce((s, p) => s + p.lng, 0) / initialProperties.length
            : 151.2093;

        const map = new google.maps.Map(mapRef.current, {
          center: { lat: centerLat, lng: centerLng },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        mapInstanceRef.current = { map, google };

        const bounds = new google.maps.LatLngBounds();
        for (const p of initialProperties) {
          const marker = new google.maps.Marker({
            position: { lat: p.lat, lng: p.lng },
            map,
            title: p.name,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 6,
              fillColor: "#0E7C9A",
              fillOpacity: 0.65,
              strokeWeight: 1,
              strokeColor: "#0E7C9A",
            },
          });
          propertyMarkersRef.current.push(marker);
          bounds.extend(marker.getPosition()!);
        }
        if (initialProperties.length > 1) map.fitBounds(bounds);
      } catch (err) {
        if (!cancelled) {
          setMapError(
            err instanceof Error ? err.message : "Failed to load Google Maps.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialProperties]);

  // ── Initial snapshot of recent cleaner pings ───────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/ops/live-locations")
      .then((r) => r.json())
      .then((data: { pings?: RawPing[] }) => {
        if (cancelled) return;
        const m = new Map<string, CleanerLocation>();
        for (const p of data.pings ?? []) {
          m.set(p.userId, {
            userId: p.userId,
            name: p.user?.name ?? p.userId.slice(0, 8),
            lat: p.lat,
            lng: p.lng,
            accuracy: p.accuracy ?? null,
            lastSeenAt: p.timestamp,
          });
        }
        setCleaners(m);
      })
      .catch(() => {
        /* SSE will populate on next ping */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── SSE live updates ───────────────────────────────────────────────
  useEffect(() => {
    // Skip the always-open stream under automated browsers (preview/e2e) so it
    // doesn't block "network idle" and hang capture tooling. Real users unaffected.
    if (typeof navigator !== "undefined" && navigator.webdriver) return;
    const es = new EventSource("/api/admin/ops/live-locations/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          ping?: RawPing;
        };
        if (msg.type === "ping" && msg.ping) {
          const p = msg.ping;
          setCleaners((prev) => {
            const next = new Map(prev);
            next.set(p.userId, {
              userId: p.userId,
              name: p.user?.name ?? p.userId.slice(0, 8),
              lat: p.lat,
              lng: p.lng,
              accuracy: p.accuracy ?? null,
              lastSeenAt: p.timestamp,
            });
            return next;
          });
        }
      } catch {
        /* malformed — ignore */
      }
    };
    return () => es.close();
  }, []);

  // ── Render/update cleaner markers when state changes ───────────────
  useEffect(() => {
    const instance = mapInstanceRef.current;
    if (!instance) return;
    const { map, google } = instance;

    const seen = new Set<string>();
    for (const c of Array.from(cleaners.values())) {
      seen.add(c.userId);
      const existing = cleanerMarkersRef.current.get(c.userId);
      if (existing) {
        existing.setPosition({ lat: c.lat, lng: c.lng });
        existing.setTitle(`${c.name} · ${new Date(c.lastSeenAt).toLocaleTimeString()}`);
      } else {
        const marker = new google.maps.Marker({
          position: { lat: c.lat, lng: c.lng },
          map,
          title: `${c.name} · ${new Date(c.lastSeenAt).toLocaleTimeString()}`,
          icon: {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            scale: 5,
            fillColor: "#F58A0C",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#FFFFFF",
          },
          zIndex: 100,
        });
        cleanerMarkersRef.current.set(c.userId, marker);
      }
    }
    // Remove markers for cleaners no longer in the set.
    for (const [userId, marker] of Array.from(cleanerMarkersRef.current.entries())) {
      if (!seen.has(userId)) {
        marker.setMap(null);
        cleanerMarkersRef.current.delete(userId);
      }
    }
  }, [cleaners]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">Live ops map</span>
        <span>
          {cleaners.size} active cleaner{cleaners.size === 1 ? "" : "s"} ·{" "}
          {initialProperties.length} propert
          {initialProperties.length === 1 ? "y" : "ies"}
        </span>
      </div>
      {mapError ? (
        <div className="flex h-[600px] w-full items-center justify-center rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground">
          {mapError}
        </div>
      ) : (
        <div
          ref={mapRef}
          className="h-[600px] w-full rounded-lg border border-border"
        />
      )}
    </div>
  );
}
