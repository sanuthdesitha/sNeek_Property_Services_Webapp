"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { LiveTripMap } from "@/components/shared/live-trip-map";

type LiveLocation = {
  jobId: string;
  jobNumber: number | null;
  jobType: string;
  jobStatus: string;
  cleanerName: string;
  cleanerUserId: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  lastPingAt: string | null;
  propertyName: string;
  propertyLat: number | null;
  propertyLng: number | null;
  etaMinutes: number | null;
  etaUpdatedAt: string | null;
  enRouteStartedAt: string | null;
  drivingPausedAt: string | null;
  drivingPauseReason: string | null;
  drivingDelayedAt: string | null;
  drivingDelayedReason: string | null;
  arrivedAt: string | null;
};

function formatEta(eta: number | null): string {
  if (eta == null) return "ETA unknown";
  if (eta <= 1) return "Arriving now";
  const arrival = new Date(Date.now() + eta * 60 * 1000);
  const time = arrival.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${eta} min · ~${time}`;
}

function formatEtaFreshness(etaUpdatedAt: string | null): string {
  if (!etaUpdatedAt) return "";
  const seconds = Math.floor((Date.now() - new Date(etaUpdatedAt).getTime()) / 1000);
  if (seconds < 60) return `updated ${seconds}s ago`;
  return `updated ${Math.floor(seconds / 60)}m ago`;
}

function formatLastPing(pingAt: string | null): string {
  if (!pingAt) return "No ping";
  const seconds = Math.floor((Date.now() - new Date(pingAt).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function getTripState(loc: LiveLocation) {
  if (loc.arrivedAt) return "Arrived";
  if (loc.jobStatus === "IN_PROGRESS") return "On site";
  if (loc.drivingPausedAt) return "Paused";
  if (loc.drivingDelayedAt) return "Delayed";
  return "On the way";
}

function getTripBadgeClasses(loc: LiveLocation) {
  if (loc.arrivedAt) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (loc.jobStatus === "IN_PROGRESS") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (loc.drivingPausedAt) return "border-slate-200 bg-slate-50 text-slate-700";
  if (loc.drivingDelayedAt) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

const POLL_INTERVAL_MS = 15_000;

export function LiveCleanerLayer() {
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchLocations() {
    try {
      const res = await fetch("/api/admin/live-locations", { cache: "no-store", headers: { "x-progress-toast": "off" } });
      if (!res.ok) { setError(true); return; }
      const data = await res.json().catch(() => []);
      setLocations(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    fetchLocations();
    intervalRef.current = setInterval(fetchLocations, POLL_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  if (locations.length === 0 && !error) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Live Cleaner Locations</CardTitle>
          {lastUpdated && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Updated {formatLastPing(lastUpdated.toISOString())} · refreshes every 15s
            </p>
          )}
        </div>
        <Badge variant="secondary" className="border-green-200 bg-green-50 text-green-800">
          {locations.length} live
        </Badge>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-muted-foreground">Could not load live locations.</p>}
        <div className="divide-y">
          {locations.map((loc) => {
            const mapsUrl =
              loc.propertyLat != null && loc.propertyLng != null
                ? `https://www.google.com/maps/dir/?api=1&destination=${loc.propertyLat},${loc.propertyLng}`
                : null;
            const tripState = getTripState(loc);
            const isExpanded = expanded === loc.jobId;

            return (
              <div key={loc.jobId} className="py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{loc.cleanerName}</p>
                      <Badge variant="outline" className={getTripBadgeClasses(loc)}>
                        {tripState}
                      </Badge>
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 text-[11px]">
                        {formatEta(loc.etaMinutes)}
                      </Badge>
                      {loc.etaUpdatedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatEtaFreshness(loc.etaUpdatedAt)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{loc.propertyName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {loc.jobType.replaceAll("_", " ")} · Last ping {formatLastPing(loc.lastPingAt)}
                    </p>
                    {loc.drivingPauseReason && (
                      <p className="text-[11px] text-slate-600">Pause: {loc.drivingPauseReason}</p>
                    )}
                    {loc.drivingDelayedReason && (
                      <p className="text-[11px] text-amber-700">Delay: {loc.drivingDelayedReason.replaceAll("_", " ")}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpanded(isExpanded ? null : loc.jobId)}
                      className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"
                    >
                      {isExpanded ? "Hide map" : "Show map"}
                    </button>
                    {mapsUrl && (
                      <a href={mapsUrl} target="_blank" rel="noreferrer"
                        className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
                        Maps
                      </a>
                    )}
                    <Link href={`/admin/jobs/${loc.jobId}`}
                      className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">
                      {loc.jobNumber ? `#${loc.jobNumber}` : "Job"}
                    </Link>
                  </div>
                </div>
                {isExpanded && (
                  <LiveTripMap
                    cleanerLat={loc.lat}
                    cleanerLng={loc.lng}
                    propertyLat={loc.propertyLat}
                    propertyLng={loc.propertyLng}
                    heading={loc.heading}
                    className="h-56"
                  />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
