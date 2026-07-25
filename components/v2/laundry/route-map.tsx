"use client";

/**
 * ESTATE laundry live route surface — the v2 Today-page route view.
 *
 * Two modes:
 *  • LEGACY (no active route): derives ALL of today's stops from the week feed
 *    (GET /api/laundry/week?start=<today Sydney>&days=2) in time+suburb order —
 *    unchanged historical behavior.
 *  • RUNNER (the driver has an ACTIVE LaundryRoute for today, from
 *    GET /api/laundry/route): stops come from the route's persisted order
 *    (incomplete first), GPS share auto-starts, and each ping's response may
 *    carry `arrivedStop` (server-side 120m geofence on the next incomplete
 *    stop) — we scroll to that stop and auto-open its action modal. Tapping
 *    any stop's action button remains a manual override. "End route" PATCHes
 *    the route COMPLETED.
 *
 * Also renders: "next stop / X of N" progress card, a Google map (numbered
 * pins, polyline, InfoWindow, multi-stop Google Maps link) and the GPS share
 * control (watchPosition → POST /api/laundry/location/ping, ~20s/50m throttle).
 */
import * as React from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  CheckCircle2,
  ExternalLink,
  Flag,
  LocateFixed,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Route as RouteIcon,
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
import { compareByTimeThenSuburb, type RouteStopKind } from "@/lib/laundry/route-plan";
import {
  useLaundryActionModal,
  type ActionTask,
  type LaundryAction,
} from "@/components/v2/laundry/laundry-action-modal";

const TZ = "Australia/Sydney";

const PICKUP_COLOR = "#0ea5e9"; // sky — pickups
const DROPOFF_COLOR = "#8b5cf6"; // violet — drop-offs
const DONE_COLOR = "#22c55e"; // green — completed stops

/* ── Types (mirror the /api/laundry/week + /api/laundry/route payloads) ──── */
type WeekProperty = {
  name?: string | null;
  address?: string | null;
  suburb?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type WeekTask = Omit<ActionTask, "property"> & {
  noPickupRequired?: boolean;
  property?: WeekProperty | null;
};

type ApiRouteStop = {
  taskId: string;
  kind: RouteStopKind;
  order: number;
  propertyId: string;
  arrivedAt?: string | null;
  completedAt?: string | null;
};

type ApiRoute = {
  id: string;
  date: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  stops: ApiRouteStop[];
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
  arrived: boolean;
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

function taskStopDone(status: string, kind: RouteStopKind): boolean {
  return kind === "PICKUP"
    ? ["PICKED_UP", "DROPPED", "SKIPPED_PICKUP"].includes(status)
    : status === "DROPPED";
}

/**
 * LEGACY derivation — ALL of today's pickup + drop stops from the week feed,
 * time+suburb sorted (comparator shared with the route builder via
 * lib/laundry/route-plan).
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
      arrived: false,
    };

    if (task.pickupDate && isSydneyToday(new Date(task.pickupDate), nowSyd)) {
      stops.push({
        ...base,
        kind: "pickup",
        scheduledAt: task.pickupDate,
        done: taskStopDone(task.status, "PICKUP"),
      });
    }
    if (task.dropoffDate && isSydneyToday(new Date(task.dropoffDate), nowSyd)) {
      stops.push({
        ...base,
        kind: "dropoff",
        scheduledAt: task.dropoffDate,
        done: taskStopDone(task.status, "DROP"),
      });
    }
  }

  return stops.sort(compareByTimeThenSuburb);
}

/** RUNNER derivation — the ACTIVE route's stops, incomplete first, in order. */
function deriveActiveRouteStops(route: ApiRoute, taskById: Map<string, WeekTask>): RouteStop[] {
  const ordered = [...route.stops].sort((a, b) => a.order - b.order);
  const mapped = ordered.map((stop): RouteStop => {
    const task = taskById.get(stop.taskId);
    const prop = task?.property ?? null;
    const scheduledAt =
      (stop.kind === "PICKUP" ? task?.pickupDate : task?.dropoffDate) ?? route.date;
    return {
      taskId: stop.taskId,
      kind: stop.kind === "PICKUP" ? "pickup" : "dropoff",
      propertyName: prop?.name ?? "Unknown property",
      address: prop?.address ?? null,
      suburb: prop?.suburb ?? null,
      lat: typeof prop?.latitude === "number" ? prop.latitude : null,
      lng: typeof prop?.longitude === "number" ? prop.longitude : null,
      status: task?.status ?? "PENDING",
      scheduledAt,
      done: Boolean(stop.completedAt) || (task ? taskStopDone(task.status, stop.kind) : false),
      arrived: Boolean(stop.arrivedAt),
    };
  });
  return [...mapped.filter((s) => !s.done), ...mapped.filter((s) => s.done)];
}

/* ── Next-stop progress card ────────────────────────────────────────────── */
function NextStopCard({ stops, runner }: { stops: RouteStop[]; runner: boolean }) {
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
                  {runner && next.arrived ? " · arrived" : ""}
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

/* ── Start / stop live GPS share ────────────────────────────────────────── */
export function RouteShareControl({
  autoStart = false,
  onArrived,
}: {
  /** Auto-begin sharing (runner mode: an ACTIVE route implies a live run). */
  autoStart?: boolean;
  /** Server said we reached the next stop — open its action surface. */
  onArrived?: (stop: { taskId: string; kind: RouteStopKind }) => void;
}) {
  const [sharing, setSharing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastPingAt, setLastPingAt] = React.useState<Date | null>(null);
  const watchIdRef = React.useRef<number | null>(null);
  const lastSentRef = React.useRef<{ at: number; lat: number; lng: number } | null>(null);
  const autoStartedRef = React.useRef(false);
  const onArrivedRef = React.useRef(onArrived);
  onArrivedRef.current = onArrived;

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
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setLastPingAt(new Date());
        const arrived = data?.arrivedStop;
        if (
          arrived &&
          typeof arrived.taskId === "string" &&
          (arrived.kind === "PICKUP" || arrived.kind === "DROP")
        ) {
          onArrivedRef.current?.(arrived);
        }
      }
    } catch {
      // Transient network failure — the next watch tick retries.
    }
  }, []);

  const startSharing = React.useCallback(() => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("This device does not support location sharing.");
      return;
    }
    if (watchIdRef.current !== null) return;
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
  }, [sendPing, stopWatch]);

  // Runner mode: share automatically once per mount when the route goes ACTIVE.
  React.useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startSharing();
    }
  }, [autoStart, startSharing]);

  function stopSharing() {
    stopWatch();
    setSharing(false);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {sharing ? (
        <EButton variant="outline" size="sm" onClick={stopSharing}>
          <Radio className="h-3.5 w-3.5 animate-pulse text-[hsl(var(--e-success))]" />
          Sharing live{lastPingAt ? ` · ${format(lastPingAt, "HH:mm:ss")}` : ""} — Stop
        </EButton>
      ) : (
        <EButton size="sm" onClick={startSharing}>
          <LocateFixed className="h-3.5 w-3.5" />
          Share GPS
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

/* ── Runner stop list (ACTIVE route only) ───────────────────────────────── */
function RunnerStopList({
  stops,
  onAction,
  onMarkDone,
}: {
  stops: RouteStop[];
  onAction: (taskId: string, action: LaundryAction) => void;
  onMarkDone: (taskId: string, kind: RouteStopKind) => void;
}) {
  return (
    <ECard>
      <ECardBody className="space-y-1 pt-6">
        <p className="mb-2 inline-flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.01em]">
          <RouteIcon className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
          Route stops
        </p>
        <ul className="space-y-1.5">
          {stops.map((stop, index) => {
            const kind: RouteStopKind = stop.kind === "pickup" ? "PICKUP" : "DROP";
            const canPickup = kind === "PICKUP" && ["PENDING", "CONFIRMED"].includes(stop.status);
            const canDrop = kind === "DROP" && stop.status === "PICKED_UP";
            return (
              <li
                key={`${stop.taskId}-${stop.kind}`}
                id={`route-stop-${stop.taskId}-${kind}`}
                className={`flex items-center justify-between gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-3 py-2 ${
                  stop.done ? "opacity-60" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="e-tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[0.75rem] font-semibold">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">
                      {stop.propertyName}
                    </p>
                    <p className="e-tnum truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {stop.kind === "pickup" ? "Pickup" : "Drop-off"}
                      {stop.suburb ? ` · ${stop.suburb}` : ""} ·{" "}
                      {format(new Date(stop.scheduledAt), "HH:mm")}
                      {stop.arrived && !stop.done ? " · arrived" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {stop.status === "FLAGGED" ? (
                    <EButton variant="outline" size="sm" asChild>
                      <a href={`/v2/laundry/tracking#task-${stop.taskId}`}>
                        <Flag className="h-3.5 w-3.5" />
                        Board
                      </a>
                    </EButton>
                  ) : null}
                  {stop.done ? (
                    <CheckCircle2 className="h-5 w-5 text-[hsl(var(--e-success))]" />
                  ) : canPickup ? (
                    <EButton size="sm" onClick={() => onAction(stop.taskId, "PICKED_UP")}>
                      Picked up
                    </EButton>
                  ) : canDrop ? (
                    <EButton size="sm" onClick={() => onAction(stop.taskId, "RETURNED")}>
                      Delivered
                    </EButton>
                  ) : (
                    <EButton
                      variant="outline"
                      size="sm"
                      onClick={() => onMarkDone(stop.taskId, kind)}
                    >
                      Mark done
                    </EButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </ECardBody>
    </ECard>
  );
}

/* ── Public component: fetch feeds + orchestrate the surfaces ───────────── */
export function LaundryRouteMap() {
  const [weekTasks, setWeekTasks] = React.useState<WeekTask[]>([]);
  const [route, setRoute] = React.useState<ApiRoute | null>(null);
  const [routeTasks, setRouteTasks] = React.useState<WeekTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [errored, setErrored] = React.useState(false);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const start = todaySydneyStartIso();
      const [weekRes, routeRes] = await Promise.all([
        fetch(`/api/laundry/week?start=${start}&days=2`, { cache: "no-store" }),
        fetch(`/api/laundry/route`, { cache: "no-store" }),
      ]);
      const weekData = await weekRes.json().catch(() => []);
      setWeekTasks(Array.isArray(weekData) ? weekData : []);
      if (routeRes.ok) {
        const routeData = await routeRes.json().catch(() => null);
        setRoute(routeData?.route ?? null);
        setRouteTasks(Array.isArray(routeData?.tasks) ? routeData.tasks : []);
      }
      setErrored(!weekRes.ok);
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

  const { openAction, modal } = useLaundryActionModal(() => void load({ silent: true }));

  const taskById = React.useMemo(() => {
    const map = new Map<string, WeekTask>();
    for (const t of weekTasks) map.set(t.id, t);
    for (const t of routeTasks) if (!map.has(t.id)) map.set(t.id, t);
    return map;
  }, [weekTasks, routeTasks]);

  const nowSyd = toZonedTime(new Date(), TZ);
  const runner =
    route != null &&
    route.status === "ACTIVE" &&
    isSydneyToday(new Date(route.date), nowSyd) &&
    route.stops.length > 0;

  const stops = React.useMemo(
    () => (runner && route ? deriveActiveRouteStops(route, taskById) : deriveRouteStops(weekTasks)),
    [runner, route, taskById, weekTasks],
  );

  const openStopAction = React.useCallback(
    (taskId: string, action: LaundryAction) => {
      const task = taskById.get(taskId);
      if (task) openAction(task, action);
    },
    [taskById, openAction],
  );

  // Arrival auto-open: scroll to the stop and pop its action modal (manual
  // taps on any other stop keep working — this is just a shortcut).
  const handleArrived = React.useCallback(
    (arrived: { taskId: string; kind: RouteStopKind }) => {
      document
        .getElementById(`route-stop-${arrived.taskId}-${arrived.kind}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      const task = taskById.get(arrived.taskId);
      if (!task) return;
      if (arrived.kind === "PICKUP" && ["PENDING", "CONFIRMED"].includes(task.status)) {
        openAction(task, "PICKED_UP");
      } else if (arrived.kind === "DROP" && task.status === "PICKED_UP") {
        openAction(task, "RETURNED");
      }
      void load({ silent: true });
    },
    [taskById, openAction, load],
  );

  const markStopDone = React.useCallback(
    async (taskId: string, kind: RouteStopKind) => {
      if (!route) return;
      try {
        await fetch(`/api/laundry/route/${route.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete-stop", taskId, kind }),
        });
      } finally {
        void load({ silent: true });
      }
    },
    [route, load],
  );

  const endRoute = React.useCallback(async () => {
    if (!route) return;
    try {
      await fetch(`/api/laundry/route/${route.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end" }),
      });
    } finally {
      void load();
    }
  }, [route, load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[1.125rem] font-semibold tracking-[-0.01em]">Live route</p>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {runner
              ? "Your planned route is live — GPS shares automatically and stops open as you arrive."
              : "Today's pickups and drop-offs — share your GPS so the office can follow the run."}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <RouteShareControl autoStart={runner} onArrived={runner ? handleArrived : undefined} />
          {runner ? (
            <EButton variant="outline" size="sm" onClick={() => void endRoute()}>
              End route
            </EButton>
          ) : (
            <EButton variant="outline" size="sm" asChild>
              <a href="/v2/laundry/route">Plan route</a>
            </EButton>
          )}
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
          <NextStopCard stops={stops} runner={runner} />
          {runner ? (
            <RunnerStopList stops={stops} onAction={openStopAction} onMarkDone={markStopDone} />
          ) : null}
          <TodayRouteMap stops={stops} />
        </>
      )}
      {modal}
    </section>
  );
}
