"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, MapPin, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { ensureGoogleMaps } from "@/lib/maps/loader";

type LiveDriver = {
  userId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  timestamp: string;
  user?: { id: string; name?: string | null } | null;
};

type LiveTask = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  pickedUpAt?: string | null;
  droppedAt?: string | null;
  flagReason?: string | null;
  property: {
    id: string;
    name: string;
    address?: string | null;
    suburb?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
};

type LivePayload = {
  now: string;
  maxOutdoorDays: number;
  drivers: LiveDriver[];
  tasks: LiveTask[];
  overdueAtLaundry: Array<{
    id: string;
    pickedUpAt: string | null;
    dropoffDate: string;
    property: { name: string; suburb: string | null };
  }>;
};

const POLL_INTERVAL_MS = 15_000;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#94a3b8",
  CONFIRMED: "#0ea5e9",
  PICKED_UP: "#8b5cf6",
  DROPPED: "#22c55e",
  FLAGGED: "#ef4444",
  SKIPPED_PICKUP: "#f59e0b",
};

function driverFreshnessColor(timestamp: string): string {
  const s = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (s < 120) return "#22c55e";
  if (s < 600) return "#f59e0b";
  return "#ef4444";
}

function stopChip(task: LiveTask): { label: string; variant: "neutral" | "info" | "primary" | "success" | "danger" | "warning" } {
  if (task.status === "DROPPED") {
    return { label: `Dropped ${task.droppedAt ? format(new Date(task.droppedAt), "HH:mm") : ""}`.trim(), variant: "success" };
  }
  if (task.status === "PICKED_UP") {
    return { label: `Picked up ${task.pickedUpAt ? format(new Date(task.pickedUpAt), "HH:mm") : ""}`.trim(), variant: "primary" };
  }
  if (task.status === "FLAGGED") return { label: "Flagged", variant: "danger" };
  if (task.status === "SKIPPED_PICKUP") return { label: "Skipped", variant: "warning" };
  if (task.status === "CONFIRMED") return { label: "Confirmed", variant: "info" };
  return { label: "Pending", variant: "neutral" };
}

/**
 * Admin "Live" view of the laundry run: the driver's latest GPS position
 * (LAUNDRY-role pings, fresh-to-stale colour-coded) plus today's pickup/drop
 * stops with status colours. Everything refreshes on one 15s poll of
 * /api/admin/laundry/live.
 */
export function AdminLaundryLive() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const stopMarkersRef = useRef<Map<string, any>>(new Map());
  const driverMarkersRef = useRef<Map<string, any>>(new Map());
  const fittedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [data, setData] = useState<LivePayload | null>(null);

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

  // One poll feeds map markers and the stop list.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/admin/laundry/live", {
          cache: "no-store",
          headers: { "x-progress-toast": "off" },
        });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as LivePayload;
        if (!cancelled) setData(payload);
      } catch {
        // Transient — next interval retries.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Fold the latest payload into map markers.
  useEffect(() => {
    if (!mapReady || !containerRef.current || !data) return;
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
    const bounds = new google.maps.LatLngBounds();
    let hasPoint = false;

    const seenStops = new Set<string>();
    for (const task of data.tasks) {
      const lat = task.property?.latitude;
      const lng = task.property?.longitude;
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      seenStops.add(task.id);
      const pos = { lat, lng };
      const icon = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: STATUS_COLOR[task.status] ?? "#94a3b8",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      };
      const title = `${task.property.name} — ${task.status.replace(/_/g, " ")}`;
      const existing = stopMarkersRef.current.get(task.id);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
        existing.setTitle(title);
      } else {
        const marker = new google.maps.Marker({ position: pos, map, icon, title, zIndex: 10 });
        const info = new google.maps.InfoWindow({
          content: `<div style="font:500 13px system-ui;color:#111;max-width:230px">${task.property.name}
              <br/><span style="font-weight:400;color:#555">${task.property.address ?? task.property.suburb ?? ""}</span>
              <br/>${task.status.replace(/_/g, " ")}
              <br/><a href="/admin/laundry" style="color:#0e7490">Open planner →</a>
            </div>`,
        });
        marker.addListener("click", () => info.open({ map, anchor: marker }));
        stopMarkersRef.current.set(task.id, marker);
      }
      bounds.extend(pos);
      hasPoint = true;
    }
    stopMarkersRef.current.forEach((marker, id) => {
      if (!seenStops.has(id)) {
        marker.setMap(null);
        stopMarkersRef.current.delete(id);
      }
    });

    const seenDrivers = new Set<string>();
    for (const driver of data.drivers) {
      seenDrivers.add(driver.userId);
      const pos = { lat: driver.lat, lng: driver.lng };
      const icon = {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: driverFreshnessColor(driver.timestamp),
        fillOpacity: 1,
        strokeColor: "#1e293b",
        strokeWeight: 3,
      };
      const title = `${driver.user?.name ?? "Laundry driver"} · ${format(new Date(driver.timestamp), "HH:mm:ss")}`;
      const existing = driverMarkersRef.current.get(driver.userId);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
        existing.setTitle(title);
      } else {
        driverMarkersRef.current.set(
          driver.userId,
          new google.maps.Marker({ position: pos, map, icon, title, zIndex: 20 }),
        );
      }
      bounds.extend(pos);
      hasPoint = true;
    }
    driverMarkersRef.current.forEach((marker, userId) => {
      if (!seenDrivers.has(userId)) {
        marker.setMap(null);
        driverMarkersRef.current.delete(userId);
      }
    });

    if (hasPoint && !fittedRef.current) {
      map.fitBounds(bounds, 56);
      fittedRef.current = true;
    }
  }, [mapReady, data]);

  const orderedTasks = useMemo(() => {
    if (!data) return [];
    return [...data.tasks].sort(
      (a, b) => new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime(),
    );
  }, [data]);

  return (
    <div className="space-y-4">
      {data && data.overdueAtLaundry.length > 0 ? (
        <Card className="border-warning/50 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-warning">
              <AlertTriangle className="h-4 w-4" />
              {data.overdueAtLaundry.length} task{data.overdueAtLaundry.length > 1 ? "s" : ""} at the laundromat
              longer than {data.maxOutdoorDays} day{data.maxOutdoorDays > 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.overdueAtLaundry.map((task) => (
              <p key={task.id} className="text-sm text-foreground">
                <span className="font-medium">{task.property.name}</span>
                {task.property.suburb ? <span className="text-muted-foreground"> · {task.property.suburb}</span> : null}
                <span className="text-muted-foreground tabular-nums">
                  {" "}
                  — picked up {task.pickedUpAt ? format(new Date(task.pickedUpAt), "d MMM HH:mm") : "?"}, due back{" "}
                  {format(new Date(task.dropoffDate), "d MMM")}
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="border-b border-border pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="size-4 text-primary" />
              Live laundry run
            </CardTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {data
                ? `${data.drivers.length} driver${data.drivers.length === 1 ? "" : "s"} live · ${data.tasks.length} stop${
                    data.tasks.length === 1 ? "" : "s"
                  } today · refreshes every 15s`
                : "Loading live data…"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loadFailed ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Map could not load.</p>
          ) : (
            <div ref={containerRef} className="h-[360px] w-full" />
          )}
          <div className="border-t border-border p-3">
            {orderedTasks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No pickups or drop-offs scheduled today.
              </p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                {orderedTasks.map((task) => {
                  const chip = stopChip(task);
                  const hasCoords =
                    typeof task.property?.latitude === "number" && typeof task.property?.longitude === "number";
                  return (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                        {!hasCoords ? <MapPin className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                        <span className="truncate font-medium">{task.property?.name}</span>
                        {task.property?.suburb ? (
                          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                            {task.property.suburb}
                          </span>
                        ) : null}
                      </span>
                      <StatusPill variant={chip.variant} size="sm">
                        {chip.label}
                      </StatusPill>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
