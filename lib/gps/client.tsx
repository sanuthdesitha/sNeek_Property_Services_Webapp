"use client";

import { useEffect, useRef, useState } from "react";
import { enqueuePing, drainQueue, clearQueue } from "./queue";

const FLUSH_INTERVAL_MS = 30_000;

export type GpsPermission = "prompt" | "granted" | "denied";

export interface GpsLastFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: string;
}

interface UseGpsTrackerOpts {
  jobId: string;
  enabled?: boolean;
}

/**
 * Hook the cleaner-side job screen calls while a job is active. While enabled
 * it asks the browser for high-accuracy position updates, queues each fix in
 * IndexedDB, and flushes the queue to /api/cleaner/location/ping every 30s
 * (and immediately on `online` events). All network failures are swallowed —
 * pings remain in the queue until a flush succeeds.
 */
export function useGpsTracker({ jobId, enabled = true }: UseGpsTrackerOpts) {
  const [permission, setPermission] = useState<GpsPermission>("prompt");
  const [lastFix, setLastFix] = useState<GpsLastFix | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const firstFixLoggedRef = useRef(false);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }

    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        setPermission("granted");
        const fix: GpsLastFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          timestamp: new Date().toISOString(),
        };
        setLastFix(fix);
        // Sanity log on first fix — admins can pull this from device-console
        // reports when investigating "wrong location" complaints. Accuracy is
        // typically <50m on GPS, 100-1000m on WiFi-only, >1000m on cell tower.
        if (!firstFixLoggedRef.current) {
          firstFixLoggedRef.current = true;
          console.info(
            `[gps] first fix accuracy=${Math.round(fix.accuracy ?? -1)}m lat=${fix.lat.toFixed(5)} lng=${fix.lng.toFixed(5)}`,
          );
        }
        try {
          await enqueuePing({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            jobId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            timestamp: fix.timestamp,
          });
        } catch {
          // IndexedDB unavailable / quota exceeded — best-effort.
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setPermission("denied");
      },
      // High-accuracy positioning: tells the browser to use GPS hardware where
      // available rather than cell tower / WiFi triangulation. maximumAge:0
      // prevents reuse of stale cached fixes. 20s timeout gives the GPS chip
      // time to acquire a satellite lock indoors.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    watchIdRef.current = id;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, jobId]);

  // Periodic flush + flush-on-reconnect.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const flush = async () => {
      if (cancelled) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const pings = await drainQueue();
        if (pings.length === 0) return;
        const res = await fetch("/api/cleaner/location/ping", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // strip local id before sending
          body: JSON.stringify(pings.map(({ id: _id, ...rest }) => rest)),
        });
        if (res.ok) {
          await clearQueue(pings.map((p) => p.id));
        }
      } catch {
        // Network or DB error — pings stay queued.
      }
    };

    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    flush(); // immediate drain on mount

    const onOnline = () => flush();
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
    };
  }, [enabled]);

  return { permission, lastFix };
}

export function GpsPermissionBanner({ permission }: { permission: GpsPermission }) {
  if (permission !== "denied") return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-30 bg-warning/10 px-4 py-2 text-center text-sm text-warning"
    >
      Live tracking is off — your manager can&apos;t see your location. Enable
      location in your browser settings.
    </div>
  );
}

/**
 * Small inline indicator for the cleaner: surfaces the last-known GPS
 * accuracy, and warns when the accuracy is poor enough that the reported
 * location is likely useless for arrival detection. Android in particular
 * defaults to "approximate" location after Android 12 — the user has to
 * grant "precise" location for the GPS chip to engage.
 */
export function GpsAccuracyIndicator({
  permission,
  lastFix,
}: {
  permission: GpsPermission;
  lastFix: GpsLastFix | null;
}) {
  if (permission !== "granted" || !lastFix) return null;
  const acc = lastFix.accuracy ?? 0;
  const lowAccuracy = acc > 200;
  return (
    <p className="text-xs text-muted-foreground">
      Last GPS fix: <span className="font-medium">±{Math.round(acc)}m</span>
      {lowAccuracy && (
        <span className="ml-2 text-warning">
          Low accuracy — grant "Precise location" in your phone&apos;s settings
          to fix this.
        </span>
      )}
    </p>
  );
}
