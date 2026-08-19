"use client";

/**
 * Native Estate driving / en-route mode. Full-page driving surface for today's
 * ordered stops. Wires the SAME endpoints v1 uses:
 *   POST /api/cleaner/jobs/[id]/start-driving   → mark EN_ROUTE (+ initial ETA)
 *   POST /api/cleaner/jobs/[id]/location-ping    → heartbeat (recomputes ETA)
 *                                                  — also carries the MANUAL ETA
 *                                                  (`manualEtaMinutes`) exactly
 *                                                  like v1, so the client-facing
 *                                                  live trip reads it unchanged
 *   POST /api/cleaner/jobs/[id]/pause-driving     → pause with reason
 *   POST /api/cleaner/jobs/[id]/resume-driving    → resume
 *   POST /api/cleaner/jobs/[id]/mark-delayed       → notify client of delay
 *   POST /api/cleaner/jobs/[id]/arrived-driving     → mark arrived
 *   POST /api/cleaner/jobs/[id]/stop-driving          → cancel → ASSIGNED
 *
 * The heartbeat runs on a 12s interval while a stop is EN_ROUTE and not
 * arrived — matching v1's keep-alive location tracking.
 *
 * Ported v1 driving-panel controls (components/cleaner/driving-panel.tsx):
 *  - Manual ETA entry when GPS is flaky (same location-ping write path as v1's
 *    handleSetManualEta in app/cleaner/jobs/[id]/page.tsx).
 *  - Retry GPS when the location lock is blocked (mirrors v1's
 *    startLocationTracking re-request, adapted to this file's per-tick
 *    getCurrentPosition plumbing).
 *  - Full-screen driving view / minimise. v1 never calls the document
 *    Fullscreen API — its "full screen" is a portal overlay with a body scroll
 *    lock, which is exactly why it works on iOS Safari (where
 *    requestFullscreen is unavailable). We mirror that mechanism.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import {
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
  Maximize2,
  Minimize2,
  LocateFixed,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/cleaner/fields";
import {
  applyStoredOrder,
  isoDay,
  loadStoredOrder,
  TRAVEL_MODE_META,
  type RouteStop,
  type TravelMode,
} from "@/components/v2/cleaner/route-timeline";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PING_INTERVAL_MS = 12_000;
/** The location-ping API rejects manual ETAs outside 1..480 (route.ts zod schema). */
const MANUAL_ETA_MIN = 1;
const MANUAL_ETA_MAX = 480;

function fullAddress(s: RouteStop) {
  return [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(", ");
}
function navUrl(s: RouteStop, mode: TravelMode) {
  const dest = s.latitude != null && s.longitude != null ? `${s.latitude},${s.longitude}` : fullAddress(s);
  const travelmode = TRAVEL_MODE_META[mode].etaMode;
  return `https://www.google.com/maps/dir/?api=1&travelmode=${travelmode}&destination=${encodeURIComponent(dest)}`;
}

export function DrivingMode({
  initialStops,
  userId,
  mode = "DRIVING",
}: {
  initialStops: RouteStop[];
  /** Cleaner id — reads the SAME saved per-day order the timeline writes. */
  userId?: string;
  /** The cleaner's transport mode — drives the "On the way" copy, icon, nav
   *  links, and pause reasons. Defaults to driving so nothing breaks for users
   *  who never set a mode. */
  mode?: TravelMode;
}) {
  const modeMeta = TRAVEL_MODE_META[mode];
  const [stops, setStops] = React.useState<RouteStop[]>(initialStops);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState(modeMeta.pauseReasons[0]);
  const [lastPingAt, setLastPingAt] = React.useState<number | null>(null);
  /**
   * Optimistic pause state. The server is authoritative (`stop.drivingPausedAt`
   * now travels with every route payload), but the refresh round-trip is a
   * network hop — without this the button doesn't flip until the refetch lands.
   * Cleared automatically the moment the server payload agrees.
   */
  const [pauseOverride, setPauseOverride] = React.useState<boolean | null>(null);
  /** Manual ETA input (minutes, as typed) — only offered while no GPS ETA exists. */
  const [manualEta, setManualEta] = React.useState("");
  /**
   * Hard GPS failure (permission blocked / unsupported device). Transient
   * failures (timeout, no fix yet) do NOT raise this — mirroring v1, which
   * only surfaces the Retry banner for PERMISSION_DENIED and lets the watcher
   * ride out temporary dropouts.
   */
  const [gpsError, setGpsError] = React.useState<string | null>(null);
  /** Immersive full-screen driving view (portal overlay — see header comment). */
  const [fullScreen, setFullScreen] = React.useState(false);
  // createPortal needs document.body, which only exists after mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  /**
   * Last successful GPS fix. The manual-ETA write reuses it (v1 sends the last
   * known ping's coords with the manual ETA so the server still logs a sane
   * position; 0,0 fallback matches v1's handler exactly).
   */
  const lastFixRef = React.useRef<{ lat: number; lng: number } | null>(null);

  // Consume the cleaner's saved order for today so Drive mode and the Timeline
  // walk the SAME sequence. Applied after mount (localStorage is client-only).
  React.useEffect(() => {
    if (!userId) return;
    setStops((cur) => applyStoredOrder(cur, loadStoredOrder(userId, isoDay(0))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The active en-route stop (the one being driven to), else the next actionable stop.
  const activeStop = stops.find((s) => s.status === "EN_ROUTE") ?? null;
  const nextStop =
    activeStop ??
    stops.find((s) => s.status === "ASSIGNED") ??
    stops.find((s) => !["COMPLETED", "INVOICED", "SUBMITTED", "QA_REVIEW"].includes(s.status)) ??
    null;
  const serverPaused = Boolean(activeStop?.drivingPausedAt);
  const paused = pauseOverride ?? serverPaused;
  const arrived = Boolean(activeStop?.arrivedAt);
  // Manual entry is only offered while the trip has no ETA at all — same gate
  // as v1 (`enRouteEtaMinutes == null && !arrivedAt`). Once a GPS ping computes
  // one, the input disappears and heartbeats keep it fresh.
  const showManualEta = Boolean(activeStop) && !arrived && activeStop?.enRouteEtaMinutes == null;
  // The overlay auto-collapses on arrival, matching v1's
  // `fullScreen={driveFullScreen && !job?.arrivedAt}` gate.
  const overlayOpen = fullScreen && Boolean(activeStop) && !arrived;

  // Drop the optimistic flag once the server payload reports the same state,
  // and whenever the active stop changes (a new drive starts unpaused).
  React.useEffect(() => {
    if (pauseOverride !== null && pauseOverride === serverPaused) setPauseOverride(null);
  }, [pauseOverride, serverPaused]);
  React.useEffect(() => {
    setPauseOverride(null);
  }, [activeStop?.jobId]);

  // Lock background scroll while the immersive view is open (same as v1's
  // overlay — the page behind must not scroll under the fixed layer).
  React.useEffect(() => {
    if (!overlayOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [overlayOpen]);

  async function refresh() {
    try {
      const res = await fetch("/api/cleaner/today-route", { cache: "no-store", headers: { "x-progress-toast": "off" } });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.stops)) {
          setStops(applyStoredOrder(data.stops, userId ? loadStoredOrder(userId, isoDay(0)) : null));
        }
      }
    } catch {
      /* keep last */
    }
  }

  function gps(): Promise<{ lat: number; lng: number; accuracy: number | null; heading: number | null; speed: number | null } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        setGpsError("This device does not support location tracking.");
        return resolve(null);
      }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          // A good fix clears any stale error and is remembered for the
          // manual-ETA write path.
          lastFixRef.current = { lat: p.coords.latitude, lng: p.coords.longitude };
          setGpsError(null);
          resolve({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracy: p.coords.accuracy ?? null,
            heading: p.coords.heading ?? null,
            speed: p.coords.speed ?? null,
          });
        },
        (err) => {
          // Only a hard permission block earns the banner — v1 treats
          // TIMEOUT / POSITION_UNAVAILABLE as transient and keeps trying
          // silently on the next heartbeat tick.
          if (err.code === err.PERMISSION_DENIED) {
            setGpsError(
              "Location access is blocked. Allow location for this site in your browser settings, then tap Retry GPS."
            );
          }
          resolve(null);
        },
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

  // Heartbeat loop while a stop is en route (not arrived) AND not paused.
  // Pausing tears the interval down (and stops asking for GPS) — previously the
  // loop kept pinging through a pause, so the cleaner's location kept flowing
  // and the ETA machinery stayed warm even though the drive was "paused".
  React.useEffect(() => {
    if (!activeStop || arrived || paused) return;
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
  }, [activeStop?.jobId, arrived, paused]); // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Manual ETA — the SAME write path v1 uses (handleSetManualEta in
   * app/cleaner/jobs/[id]/page.tsx): the ETA rides the location-ping endpoint
   * as `manualEtaMinutes`, so the client-facing live trip reads it from
   * exactly the same place as GPS-computed ETAs. Coordinates fall back to the
   * last known fix, else 0,0 — identical to v1's payload.
   */
  function submitManualEta() {
    if (!activeStop) return;
    const mins = parseInt(manualEta, 10);
    if (!mins || mins < MANUAL_ETA_MIN) return;
    if (mins > MANUAL_ETA_MAX) {
      toast({
        title: "ETA too far out",
        description: `Manual ETAs are capped at ${MANUAL_ETA_MAX} minutes.`,
        variant: "destructive",
      });
      return;
    }
    void run("manual-eta", async () => {
      const fix = lastFixRef.current;
      await post(`/api/cleaner/jobs/${activeStop.jobId}/location-ping`, {
        lat: fix?.lat ?? 0,
        lng: fix?.lng ?? 0,
        manualEtaMinutes: mins,
      });
      setManualEta("");
      toast({ title: "ETA set", description: `The client now sees you about ${mins} min away.` });
    });
  }

  /**
   * Retry GPS — v2's equivalent of v1's `onRetryGps={() => startLocationTracking()}`.
   * v1 restarts its watchPosition watcher; this file has no persistent watcher
   * (the 12s heartbeat calls getCurrentPosition per tick), so retry =
   * re-request a fix RIGHT NOW. That re-triggers the browser permission prompt
   * where the platform allows it, and on success we ship a ping immediately so
   * the ETA machinery restarts without waiting for the next tick.
   */
  async function retryGps() {
    setBusy("retry-gps");
    // Optimistic clear — a fresh denial re-raises the banner from gps().
    setGpsError(null);
    try {
      const loc = await gps();
      if (!loc) return; // gps() already set the error message if it was a hard block
      if (activeStop && !arrived && !paused) {
        try {
          await post(`/api/cleaner/jobs/${activeStop.jobId}/location-ping`, loc);
          setLastPingAt(Date.now());
          await refresh();
        } catch {
          /* transient — the heartbeat retries */
        }
      }
      toast({ title: "GPS lock restored", description: "Live location updates are flowing again." });
    } finally {
      setBusy(null);
    }
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

  const errorBanner = error ? (
    <ECard className="border-[hsl(var(--e-danger))]">
      <ECardBody className="pt-5 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</ECardBody>
    </ECard>
  ) : null;

  const statusBadge = activeStop ? (
    <EBadge tone={arrived ? "success" : paused ? "warning" : "info"} soft>
      {arrived ? "Arrived" : paused ? "Paused" : "En route"}
    </EBadge>
  ) : null;

  // Shared between the inline card and the full-screen overlay so both shapes
  // render the SAME controls (v1 does the same with its `controls` block).
  const heroBody = nextStop ? (
    <>
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

      {/* Manual ETA — GPS fallback. Only visible while the trip has no ETA. */}
      {showManualEta && activeStop ? (
        <div className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            No GPS ETA yet — tell the client how many minutes out you are.
          </p>
          <div className="flex items-center gap-2">
            <EInput
              type="number"
              min={MANUAL_ETA_MIN}
              max={MANUAL_ETA_MAX}
              inputMode="numeric"
              placeholder="min"
              aria-label="Manual ETA in minutes"
              value={manualEta}
              onChange={(e) => setManualEta(e.target.value)}
              className="w-24"
            />
            <EButton
              variant="outline"
              disabled={busy === "manual-eta" || !manualEta || Number.isNaN(Number(manualEta))}
              onClick={submitManualEta}
            >
              {busy === "manual-eta" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
              Set ETA
            </EButton>
          </div>
        </div>
      ) : null}

      {/* Hard GPS failure banner + retry (permission blocked / unsupported). */}
      {gpsError && activeStop && !arrived ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.08)] px-3 py-2">
          <p className="text-[0.75rem] text-[hsl(var(--e-foreground))]">{gpsError}</p>
          <EButton variant="outline" disabled={busy === "retry-gps"} onClick={() => void retryGps()}>
            {busy === "retry-gps" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
            Retry GPS
          </EButton>
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
            <a href={navUrl(activeStop, mode)} target="_blank" rel="noreferrer">
              <EButton variant="gold">
                <modeMeta.Icon className="h-4 w-4" /> Navigate
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
          {paused ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Drive paused — location updates are stopped
              {activeStop.drivingPauseReason ? ` · ${activeStop.drivingPauseReason}` : ""}. Tap
              “Resume drive” when you’re moving again.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {modeMeta.pauseReasons.map((r) => (
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
                onClick={() =>
                  run("resume", async () => {
                    setPauseOverride(false);
                    try {
                      const loc = await gps();
                      await post(
                        `/api/cleaner/jobs/${activeStop.jobId}/resume-driving`,
                        loc ? { lat: loc.lat, lng: loc.lng } : {}
                      );
                    } catch (e) {
                      setPauseOverride(true); // roll back the optimistic flip
                      throw e;
                    }
                  })
                }
              >
                {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TimerReset className="h-4 w-4" />}
                Resume drive
              </EButton>
            ) : (
              <EButton
                variant="outline"
                size="sm"
                disabled={busy === "pause"}
                onClick={() =>
                  run("pause", async () => {
                    setPauseOverride(true); // stops the heartbeat immediately
                    try {
                      await post(`/api/cleaner/jobs/${activeStop.jobId}/pause-driving`, { reason });
                    } catch (e) {
                      setPauseOverride(false); // roll back the optimistic flip
                      throw e;
                    }
                  })
                }
              >
                {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                Pause drive
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
    </>
  ) : null;

  // ── Immersive full-screen driving view ──────────────────────────────────
  // Portal overlay, NOT document.requestFullscreen — v1's mechanism, chosen
  // because it behaves identically on iOS Safari where the Fullscreen API is
  // missing. Rendered INSTEAD of the inline surface; the component (and its
  // heartbeat interval) stays mounted throughout.
  if (overlayOpen && mounted && activeStop) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex flex-col bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
        <header className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.9375rem] font-[650]">{activeStop.propertyName}</p>
            <p className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{fullAddress(activeStop) || "Address not set"}</span>
            </p>
          </div>
          {statusBadge}
          <EButton variant="ghost" size="icon" aria-label="Minimise driving view" onClick={() => setFullScreen(false)}>
            <Minimize2 className="h-5 w-5" />
          </EButton>
        </header>
        {/* pb uses the safe-area inset so the bottom controls clear the iOS home bar. */}
        <div className="flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="space-y-4">
            {errorBanner}
            {heroBody}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ── Inline surface ──────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {errorBanner}

      {/* Next-stop hero */}
      {nextStop ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-4 pt-6">
            <div className="flex items-center justify-between gap-2">
              <p className="e-eyebrow">{activeStop ? modeMeta.headingVerb.toUpperCase() : "NEXT STOP"}</p>
              <div className="flex items-center gap-1.5">
                {statusBadge}
                {activeStop && !arrived ? (
                  <EButton
                    variant="ghost"
                    size="icon"
                    aria-label="Enter full-screen driving view"
                    onClick={() => setFullScreen(true)}
                  >
                    <Maximize2 className="h-5 w-5" />
                  </EButton>
                ) : null}
              </div>
            </div>

            <div>
              <p className="e-display-sm">{nextStop.propertyName}</p>
              <p className="mt-1 flex items-start gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {fullAddress(nextStop) || "Address not set"}
              </p>
            </div>

            {heroBody}
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
