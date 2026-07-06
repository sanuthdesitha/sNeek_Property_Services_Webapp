"use client";

/**
 * ESTATE laundry live route map — the v2 Today-page route surface. Fetches the
 * SAME feed the v1 planner uses (GET /api/laundry/week?start=<today Sydney>
 * &days=2), derives today's pickup + drop-off stops exactly like v1, and
 * renders them natively in Estate chrome:
 *   • a "next stop / X of N" progress card
 *   • a Start route / End route live GPS share (watch → ~20s/50m throttle →
 *     POST /api/laundry/location/ping { lat, lng, accuracy?, timestamp })
 *   • a Google map (numbered pickup/drop/done pins, polyline, InfoWindow with a
 *     /v2/laundry deep link, "running late" flag, "Open in Google Maps"
 *     multi-stop link) + a list of stops with no coordinates.
 *
 * Zero imports from live components/ui/* or components/laundry/*. Map mounted
 * via the shared lib/maps/loader, following components/v2/admin/ops/
 * estate-ops-map.tsx.
 */
import * as React from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ensureGoogleMaps } from "@/lib/maps/loader";
import { buildGoogleMapsMultiStopUrl } from "@/lib/jobs/schedule-order";

const TZ = "Australia/Sydney";

const PICKUP_COLOR = "#0ea5e9"; // sky — pickups
const DROPOFF_COLOR = "#8b5cf6"; // violet — drop-offs
const DONE_COLOR = "#22c55e"; // green — completed stops

/* ── Types (mirror the /api/laundry/week payload) ──────────────────────── */
type WeekProperty = {
  name?: string | null;
  address?: string | null;
  suburb?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type WeekTask = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  noPickupRequired?: boolean;
  property?: WeekProperty | null;
};

type RouteStop = {
  taskId: string;
  kind: "pickup" | "dropoff";
  propertyName: string;
  address: string | null;
  suburb: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  scheduledAt: string;
  done: boolean;
};

function stopIsLate(stop: RouteStop, now: Date): boolean {
  if (stop.done) return false;
  if (stop.status === "DROPPED" || stop.status === "SKIPPED_PICKUP") return false;
  return new Date(stop.scheduledAt).getTime() < now.getTime();
}

/** Today's Sydney midnight, as an ISO string for the week feed's `start`. */
function todaySydneyStartIso(): string {
  const nowSyd = toZonedTime(new Date(), TZ);
  const start = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), nowSyd.getDate());
  return start.toISOString();
}

/** True when a Date falls on the same Sydney calendar day as `now`. */
function isSydneyToday(value: Date, nowSyd: Date): boolean {
  const d = toZonedTime(value, TZ);
  return (
    d.getFullYear() === nowSyd.getFullYear() &&
    d.getMonth() === nowSyd.getMonth() &&
    d.getDate() === nowSyd.getDate()
  );
}

/**
 * Derive today's route stops from the week feed, exactly like v1
 * (app/laundry/today/page.tsx): pickups off pickupDate (done once
 * PICKED_UP/DROPPED/SKIPPED_PICKUP), dropoffs off dropoffDate (done once
 * DROPPED). Sorted by scheduled time, then suburb.
 */
function deriveRouteStops(tasks: WeekTask[]): RouteStop[] {
  const nowSyd = toZonedTime(new Date(), TZ);
  const stops: RouteStop[] = [];

  for (const task of tasks) {
    if (task.noPickupRequired) continue;
    const prop = task.property ?? null;
    const base = {
      taskId: task.id,
      propertyName: prop?.name ?? "Unknown property",
      address: prop?.address ?? null,
      suburb: prop?.suburb ?? null,
      lat: typeof prop?.latitude === "number" ? prop.latitude : null,
      lng: typeof prop?.longitude === "number" ? prop.longitude : null,
      status: task.status,
    };

    if (task.pickupDate && isSydneyToday(new Date(task.pickupDate), nowSyd)) {
      stops.push({
        ...base,
        kind: "pickup",
        scheduledAt: task.pickupDate,
        done: ["PICKED_UP", "DROPPED", "SKIPPED_PICKUP"].includes(task.status),
      });
    }
    if (task.dropoffDate && isSydneyToday(new Date(task.dropoffDate), nowSyd)) {
      stops.push({
        ...base,
        kind: "dropoff",
        scheduledAt: task.dropoffDate,
        done: task.status === "DROPPED",
      });
    }
  }

  stops.sort((a, b) => {
    const timeDiff = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return (a.suburb ?? "").localeCompare(b.suburb ?? "");
  });
  return stops;
}

/* ── Next-stop progress card ────────────────────────────────────────────── */
function NextStopCard({ stops }: { stops: RouteStop[] }) {
  const doneCount = stops.filter((s) => s.done).length;
  const next = stops.find((s) => !s.done);
  const pct = stops.length > 0 ? Math.round((doneCount / stops.length) * 100) : 0;

  return (
    <ECard>
      <ECardBody className="space-y-2 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
              <Navigation className="h-4 w-4" />
            </span>
            {next ? (
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]">
                  Next: {next.propertyName}
                  <span className="ml-1.5 font-normal text-[hsl(var(--e-muted-foreground))]">
                    ({next.kind === "pickup" ? "pickup" : "drop-off"}
                    {next.suburb ? ` · ${next.suburb}` : ""})
                  </span>
                </p>
                <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Stop {doneCount + 1} of {stops.length} · scheduled{" "}
                  {format(new Date(next.scheduledAt), "HH:mm")}
                </p>
              </div>
            ) : (
              <p className="text-[0.875rem] font-semibold text-[hsl(var(--e-success))]">
                All {stops.length} stops done — route complete.
              </p>
            )}
          </div>
          <EBadge tone={next ? "info" : "success"} soft>
            {doneCount}/{stops.length} done
          </EBadge>
        </div>
        <div className="h-1.5 overflow-hidden rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-border))]">
          <div
            className="h-full rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-success))] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </ECardBody>
    </ECard>
  );
}

/* ── Start route / End route live GPS share ─────────────────────────────── */
function RouteShareControl() {
  const [sharing, setSharing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastPingAt, setLastPingAt] = React.useState<Date | null>(null);
  const watchIdRef = React.useRef<number | null>(null);
  const lastSentRef = React.useRef<{ at: number; lat: number; lng: number } | null>(null);

  const stopWatch = React.useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
    lastSentRef.current = null;
  }, []);

  React.useEffect(() => () => stopWatch(), [stopWatch]);

  const sendPing = React.useCallback(async (pos: GeolocationPosition) => {
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
      // Transient network failure — the next watch tick retries.
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
        <EButton variant="outline" size="sm" onClick={endRoute}>
          <Radio className="h-3.5 w-3.5 animate-pulse text-[hsl(var(--e-success))]" />
          Sharing live{lastPingAt ? ` · ${format(lastPingAt, "HH:mm:ss")}` : ""} — End route
        </EButton>
      ) : (
        <EButton size="sm" onClick={startRoute}>
          <LocateFixed className="h-3.5 w-3.5" />
          Start route
        </EButton>
      )}
      {error ? (
        <p className="max-w-xs text-right text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p>
      ) : null}
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Google route map ───────────────────────────────────────────────────── */
function TodayRouteMap({ stops }: { stops: RouteStop[] }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<any>(null);
  const markersRef = React.useRef<any[]>([]);
  const polylineRef = React.useRef<any>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const now = React.useMemo(() => new Date(), [stops]);

  const located = React.useMemo(
    () => stops.filter((s) => typeof s.lat === "number" && typeof s.lng === "number"),
    [stops],
  );
  const unlocated = React.useMemo(
    () => stops.filter((s) => typeof s.lat !== "number" || typeof s.lng !== "number"),
    [stops],
  );

  const mapsUrl = React.useMemo(
    () =>
      buildGoogleMapsMultiStopUrl(
        stops.map((s) => s.address ?? (s.suburb ? `${s.propertyName}, ${s.suburb}` : null)),
        { fromCurrentLocation: true },
      ),
    [stops],
  );

  React.useEffect(() => {
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

  React.useEffect(() => {
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

    // Clear the previous render (stops re-derive on every data refresh).
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
            ${index + 1}. ${escapeHtml(stop.propertyName)}
            <br/><span style="font-weight:400;color:#555">${escapeHtml(stop.address ?? stop.suburb ?? "")}</span>
            <br/><span style="font-weight:600;color:${color}">${stop.kind === "pickup" ? "Pickup" : "Drop-off"}</span>
            · ${escapeHtml(stop.status.replace(/_/g, " "))}
            ${late ? '<span style="color:#ef4444;font-weight:600"> · running late</span>' : ""}
            <br/><a href="/v2/laundry" style="color:#0e7490">Open →</a>
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

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.01em]">
            <MapPin className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
            Today&apos;s route
            <span className="e-tnum text-[0.8125rem] font-normal text-[hsl(var(--e-muted-foreground))]">
              {located.length} mapped stop{located.length === 1 ? "" : "s"}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PICKUP_COLOR }} /> Pickup
              <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: DROPOFF_COLOR }} /> Drop-off
              <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: DONE_COLOR }} /> Done
            </span>
            {mapsUrl ? (
              <EButton variant="outline" size="sm" asChild>
                <a href={mapsUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open in Google Maps
                </a>
              </EButton>
            ) : null}
          </div>
        </div>

        {loadFailed ? (
          <p className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Map could not load — use &quot;Open in Google Maps&quot; instead.
          </p>
        ) : located.length === 0 ? (
          <p className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            None of today&apos;s stops have saved coordinates yet — ask an admin to set property locations.
          </p>
        ) : (
          <div
            ref={containerRef}
            className="h-[320px] w-full overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] sm:h-[400px]"
          />
        )}

        {unlocated.length > 0 ? (
          <div className="border-t border-[hsl(var(--e-border))] pt-3">
            <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-gold-ink))]">
              No location on file ({unlocated.length})
            </p>
            <ul className="space-y-1">
              {unlocated.map((stop) => (
                <li
                  key={`${stop.taskId}-${stop.kind}`}
                  className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-foreground))]"
                >
                  <EBadge tone={stop.kind === "pickup" ? "info" : "primary"} soft>
                    {stop.kind === "pickup" ? "Pickup" : "Drop-off"}
                  </EBadge>
                  <span className="min-w-0 truncate">{stop.propertyName}</span>
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {stop.suburb ?? "No address"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

/* ── Public component: fetch feed + orchestrate the surfaces ────────────── */
export function LaundryRouteMap() {
  const [stops, setStops] = React.useState<RouteStop[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errored, setErrored] = React.useState(false);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const start = todaySydneyStartIso();
      const res = await fetch(`/api/laundry/week?start=${start}&days=2`, { cache: "no-store" });
      const data = await res.json();
      const tasks: WeekTask[] = Array.isArray(data) ? data : [];
      setStops(deriveRouteStops(tasks));
      setErrored(!res.ok);
    } catch {
      setErrored(true);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const id = setInterval(() => void load({ silent: true }), 20_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[1.125rem] font-semibold tracking-[-0.01em]">Live route</p>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Today&apos;s pickups and drop-offs — share your GPS so the office can follow the run.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <RouteShareControl />
          <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </EButton>
        </div>
      </div>

      {errored && stops.length === 0 ? (
        <EEmptyState
          eyebrow="Unavailable"
          title="Could not load today's route"
          description="The laundry feed did not respond. Try Refresh in a moment."
        />
      ) : stops.length === 0 ? (
        <EEmptyState
          eyebrow="Quiet"
          title="No stops today"
          description={loading ? "Loading today's route…" : "No pickups or drop-offs are scheduled for today."}
        />
      ) : (
        <>
          <NextStopCard stops={stops} />
          <TodayRouteMap stops={stops} />
        </>
      )}
    </section>
  );
}
