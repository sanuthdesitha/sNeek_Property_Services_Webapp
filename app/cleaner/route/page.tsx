"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Navigation, MapPin, Clock, ExternalLink, RefreshCw, Loader2, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveTripMap } from "@/components/shared/live-trip-map";

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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline" | "warning"> = {
  EN_ROUTE: "warning",
  IN_PROGRESS: "default",
  COMPLETED: "secondary",
};

type Stop = {
  jobId: string;
  jobNumber: number | null;
  jobType: string;
  status: string;
  startTime: string | null;
  dueTime: string | null;
  enRouteStartedAt: string | null;
  enRouteEtaMinutes: number | null;
  arrivedAt: string | null;
  propertyName: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
};

function buildRouteUrl(stops: Stop[], currentLat?: number, currentLng?: number): string | null {
  const addresses = stops.map((s) => `${s.address}, ${s.suburb} ${s.state}`);
  if (addresses.length === 0) return null;

  const params = new URLSearchParams({ api: "1", travelmode: "driving" });

  if (currentLat != null && currentLng != null) {
    params.set("origin", `${currentLat},${currentLng}`);
  }
  // Last stop is the destination
  params.set("destination", addresses[addresses.length - 1]);
  // Middle stops are waypoints
  const waypoints = addresses.slice(0, -1);
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildSingleJobUrl(stop: Stop, currentLat?: number, currentLng?: number): string {
  const dest = encodeURIComponent(`${stop.address}, ${stop.suburb} ${stop.state}`);
  if (currentLat != null && currentLng != null) {
    return `https://www.google.com/maps/dir/?api=1&origin=${currentLat},${currentLng}&destination=${dest}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

export default function CleanerRoutePage() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locError, setLocError] = useState(false);
  const [mapJobId, setMapJobId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchRoute = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cleaner/today-route", { cache: "no-store", headers: { "x-progress-toast": "off" } });
      if (!res.ok) throw new Error("Could not load route");
      const data = await res.json();
      setStops(Array.isArray(data.stops) ? data.stops : []);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoute();
  }, [fetchRoute]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setCurrentPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocError(true),
      { enableHighAccuracy: true, maximumAge: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const fullRouteUrl = buildRouteUrl(stops, currentPos?.lat, currentPos?.lng);

  async function handleCopyRoute() {
    if (!fullRouteUrl) return;
    try {
      await navigator.clipboard.writeText(fullRouteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select a temp input
      const input = document.createElement("input");
      input.value = fullRouteUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Navigation className="h-5 w-5 text-primary" />
            Today&apos;s Route
          </h1>
          <p className="text-sm text-muted-foreground">
            {stops.length} stop{stops.length !== 1 ? "s" : ""} today
            {currentPos ? " · GPS active" : locError ? " · GPS unavailable" : " · locating..."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchRoute}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {fullRouteUrl && stops.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleCopyRoute}>
                {copied ? <Check className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? "Copied!" : "Copy link"}
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

      {error && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      )}

      {stops.length === 0 && !error && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No active jobs scheduled for today.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {stops.map((stop, index) => {
          const singleUrl = buildSingleJobUrl(stop, currentPos?.lat, currentPos?.lng);
          const showMap = mapJobId === stop.jobId;

          return (
            <Card key={stop.jobId} className={stop.status === "EN_ROUTE" ? "border-amber-300 bg-amber-50/40" : ""}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <CardTitle className="text-sm font-semibold">{stop.propertyName}</CardTitle>
                    <Badge variant={STATUS_VARIANT[stop.status] ?? "outline"}>
                      {STATUS_LABELS[stop.status] ?? stop.status}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{stop.address}, {stop.suburb} {stop.state} {stop.postcode}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {stop.startTime && stop.dueTime
                      ? `${stop.startTime} – ${stop.dueTime}`
                      : stop.startTime || stop.dueTime || "No time set"}
                  </span>
                  <span>{stop.jobType.replace(/_/g, " ")}</span>
                  {stop.status === "EN_ROUTE" && stop.enRouteEtaMinutes != null && (
                    <span className="text-amber-700 font-medium">
                      {stop.enRouteEtaMinutes <= 1
                        ? "Arriving now"
                        : (() => {
                            const arrival = new Date(Date.now() + stop.enRouteEtaMinutes * 60 * 1000);
                            const time = arrival.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
                            return `${stop.enRouteEtaMinutes} min · ~${time}`;
                          })()}
                    </span>
                  )}
                  {stop.arrivedAt && (
                    <span className="text-emerald-700 font-medium">Arrived</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <a href={singleUrl} target="_blank" rel="noreferrer">
                      <Navigation className="mr-1.5 h-3.5 w-3.5" />
                      Navigate
                    </a>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMapJobId(showMap ? null : stop.jobId)}
                  >
                    {showMap ? "Hide map" : "Show map"}
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/cleaner/jobs/${stop.jobId}`}>Open job</Link>
                  </Button>
                </div>
                {showMap && (
                  <LiveTripMap
                    cleanerLat={currentPos?.lat ?? null}
                    cleanerLng={currentPos?.lng ?? null}
                    propertyLat={stop.latitude}
                    propertyLng={stop.longitude}
                    className="h-52 mt-2"
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
