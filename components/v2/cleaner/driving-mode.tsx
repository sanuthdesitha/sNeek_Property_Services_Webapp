"use client";

/**
 * Native Estate driving / en-route mode. Full-page driving surface for today's
 * ordered stops. Wires the SAME endpoints v1 uses:
 *   POST /api/cleaner/jobs/[id]/start-driving   → mark EN_ROUTE (+ initial ETA)
 *   POST /api/cleaner/jobs/[id]/location-ping    → heartbeat (recomputes ETA)
 *   POST /api/cleaner/jobs/[id]/pause-driving     → pause with reason
 *   POST /api/cleaner/jobs/[id]/resume-driving    → resume
 *   POST /api/cleaner/jobs/[id]/mark-delayed       → notify client of delay
 *   POST /api/cleaner/jobs/[id]/arrived-driving     → mark arrived
 *   POST /api/cleaner/jobs/[id]/stop-driving          → cancel → ASSIGNED
 *
 * The heartbeat runs on a 12s interval while a stop is EN_ROUTE and not
 * arrived — matching v1's keep-alive location tracking.
 */
import * as React from "react";
import {
  Navigation,
  MapPin,
  Play,
  Pause,
  TimerReset,
  Flag,
  Square,
  Loader2,
  Clock,
  CircleDot,
  TrafficCone,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import type { RouteStop } from "@/components/v2/cleaner/route-timeline";
import { cn } from "@/lib/utils";

const PING_INTERVAL_MS = 12_000;
const REASONS = ["Traffic", "Fuel", "Break", "Previous job ran over", "Parking"];

function fullAddress(s: RouteStop) {
  return [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(", ");
}
function navUrl(s: RouteStop) {
  const dest = s.latitude != null && s.longitude != null ? `${s.latitude},${s.longitude}` : fullAddress(s);
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(dest)}`;
}

export function DrivingMode({ initialStops }: { initialStops: RouteStop[] }) {
  const [stops, setStops] = React.useState<RouteStop[]>(initialStops);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("Traffic");
  const [lastPingAt, setLastPingAt] = React.useState<number | null>(null);

  // The active en-route stop (the one being driven to), else the next actionable stop.
  const activeStop = stops.find((s) => s.status === "EN_ROUTE") ?? null;
  const nextStop =
    activeStop ??
    stops.find((s) => s.status === "ASSIGNED") ??
    stops.find((s) => !["COMPLETED", "INVOICED", "SUBMITTED", "QA_REVIEW"].includes(s.status)) ??
    null;
  const paused = Boolean((activeStop as any)?.drivingPausedAt);
  const arrived = Boolean(activeStop?.arrivedAt);

  async function refresh() {
    try {
      const res = await fetch("/api/cleaner/today-route", { cache: "no-store", headers: { "x-progress-toast": "off" } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.stops)) setStops(data.stops);
      }
    } catch {
      /* keep last */
    }
  }

  function gps(): Promise<{ lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) =>
          resolve({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy ?? null,
            heading: p.coords.heading ?? null,
            speed: p.coords.speed ?? null,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 12000 }
      );
    });
  }

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // Heartbeat loop while a stop is en route (not arrived).
  React.useEffect(() => {
    if (!activeStop || arrived) return;
    let alive = true;
    const send = async () => {
      const loc = await gps();
      if (!loc || !alive) return;
      try {
        await post(`/api/cleaner/jobs/${activeStop.jobId}/location-ping`, loc);
        setLastPingAt(Date.now());
      } catch {
        /* transient */
      }
    };
    void send();
    const id = setInterval(send, PING_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeStop?.jobId, arrived]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function startDriving(stop: RouteStop) {
    const loc = await gps();
    await post(`/api/cleaner/jobs/${stop.jobId}/start-driving`, loc ? { lat: loc.lat, lng: loc.lng } : {});
  }

  if (stops.length === 0) {
    return (
      <EEmptyState
        eyebrow="Clear roads"
        title="No stops today"
        description="You have no jobs scheduled to drive to today."
      />
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <ECard className="border-[hsl(var(--e-danger))]">
          <ECardBody className="pt-5 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</ECardBody>
        </ECard>
      ) : null}

      {/* Next-stop hero */}
      {nextStop ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-4 pt-6">
            <div className="flex items-center justify-between">
              <p className="e-eyebrow">{activeStop ? "ON THE WAY" : "NEXT STOP"}</p>
              {activeStop ? (
                <EBadge tone={arrived ? "success" : paused ? "warning" : "info"} soft>
                  {arrived ? "Arrived" : paused ? "Paused" : "En route"}
                </EBadge>
              ) : null}
            </div>

            <div>
              <p className="e-display-sm">{nextStop.propertyName}</p>
              <p className="mt-1 flex items-start gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {fullAddress(nextStop) || "Address not set"}
              </p>
            </div>

            {activeStop ? (
              <div className="grid grid-cols-2 gap-2">
                <Metric
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="ETA"
                  value={activeStop.enRouteEtaMinutes != null ? `${activeStop.enRouteEtaMinutes} min` : "—"}
                />
                <Metric
                  icon={<CircleDot className="h-3.5 w-3.5" />}
                  label="Last ping"
                  value={lastPingAt ? `${Math.round((Date.now() - lastPingAt) / 1000)}s ago` : "…"}
                />
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {!activeStop ? (
                <EButton
                  variant="gold"
                  disabled={busy === "start"}
                  onClick={() => run("start", () => startDriving(nextStop))}
                >
                  {busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Start driving
                </EButton>
              ) : (
                <>
                  <a href={navUrl(activeStop)} target="_blank" rel="noreferrer">
                    <EButton variant="gold">
                      <Navigation className="h-4 w-4" /> Navigate
                    </EButton>
                  </a>
                  {!arrived ? (
                    <EButton
                      variant="primary"
                      disabled={busy === "arrived"}
                      onClick={() =>
                        run("arrived", () => post(`/api/cleaner/jobs/${activeStop.jobId}/arrived-driving`).then(() => {}))
                      }
                    >
                      {busy === "arrived" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
                      I've arrived
                    </EButton>
                  ) : (
                    <EButton asChild variant="primary">
                      <a href={`/v2/cleaner/jobs/${activeStop.jobId}`}>Open job workspace</a>
                    </EButton>
                  )}
                </>
              )}
            </div>

            {/* En-route secondary controls */}
            {activeStop && !arrived ? (
              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <div className="flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={cn(
                        "rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.75rem] font-[550]",
                        reason === r
                          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]"
                          : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))]"
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {paused ? (
                    <EButton
                      variant="outline"
                      size="sm"
                      disabled={busy === "resume"}
                      onClick={() => run("resume", () => post(`/api/cleaner/jobs/${activeStop.jobId}/resume-driving`).then(() => {}))}
                    >
                      <TimerReset className="h-4 w-4" /> Resume
                    </EButton>
                  ) : (
                    <EButton
                      variant="outline"
                      size="sm"
                      disabled={busy === "pause"}
                      onClick={() => run("pause", () => post(`/api/cleaner/jobs/${activeStop.jobId}/pause-driving`, { reason }).then(() => {}))}
                    >
                      <Pause className="h-4 w-4" /> Pause
                    </EButton>
                  )}
                  <EButton
                    variant="outline"
                    size="sm"
                    disabled={busy === "delay"}
                    onClick={() => run("delay", () => post(`/api/cleaner/jobs/${activeStop.jobId}/mark-delayed`, { reason }).then(() => {}))}
                  >
                    <TrafficCone className="h-4 w-4" /> Running late
                  </EButton>
                  <EButton
                    variant="ghost"
                    size="sm"
                    disabled={busy === "stop"}
                    onClick={() => run("stop", () => post(`/api/cleaner/jobs/${activeStop.jobId}/stop-driving`).then(() => {}))}
                  >
                    <Square className="h-4 w-4" /> Stop driving
                  </EButton>
                </div>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ) : (
        <EEmptyState eyebrow="All done" title="No stops left to drive to" description="Every stop today is complete." />
      )}

      {/* Remaining ordered stops */}
      <ol className="space-y-2">
        {stops.map((s, i) => (
          <li key={s.jobId} className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-surface))] font-serif text-[0.8125rem] text-[hsl(var(--e-gold-ink))]">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.875rem] font-[550]">{s.propertyName}</p>
              <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {s.startTime || "—"} · {s.suburb}
              </p>
            </div>
            {s.jobId === activeStop?.jobId ? <EBadge tone="info" soft>Active</EBadge> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
      <p className="flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
        {icon} {label}
      </p>
      <p className="mt-0.5 text-[0.9375rem] font-[550] tabular-nums">{value}</p>
    </div>
  );
}
