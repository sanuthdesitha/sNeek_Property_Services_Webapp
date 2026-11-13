"use client";

/**
 * The one location tracker for cleaners and laundry drivers (one capture loop
 * per device). Mounted by the portal layouts while the server says the person
 * is inside their tracking window (lib/gps/tracking-window):
 *   - cleaners: useGpsTracker({ jobId }) → POST /api/cleaner/location/ping
 *   - drivers:  useRouteTracker({ routeId }) → POST /api/laundry/location/ping
 *
 * Capture: a seed fix, a high-accuracy watch, and a heartbeat that asks for a
 * FRESH fix when nothing was queued for 45 s (a still phone). Each fix keeps
 * the time it was measured; it is never re-stamped as "now".
 *
 * Transport: fixes wait in IndexedDB (lib/gps/queue) with a client id and are
 * flushed every 30 s, on reconnect, when the page is hidden and on pagehide
 * (keepalive), in batches of 50 with the phone's `sentAt` so the server can
 * correct clock skew. A rejected batch the server can never accept is
 * dropped; anything else is kept for the next flush.
 *
 * Honesty: the phone's state (sharing / in the background / permission off /
 * offline / no fix available) is sent with the next flush, so the office sees
 * WHY a position stopped, not just that it did. A watch that died or went
 * quiet is restarted when the page is visible again, or when location
 * permission is granted again.
 *
 * Never runs while an administrator is impersonating (the server refuses too).
 */
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { enqueuePing, drainQueue, clearQueue } from "./queue";
import {
  FLUSH_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_BATCH,
  interpretFlushResponse,
  newClientPingId,
  shouldQueueFix,
  shouldRestartWatch,
  trackingStateFor,
} from "./tracker-core";
import { publishRouteArrival, resetTrackerStatus, subscribeTrackerRestart, updateTrackerStatus, type LiveFix } from "./live-fix-store";
import type { TrackingState } from "./staleness";

export type GpsPermission = "prompt" | "granted" | "denied";

export interface GpsLastFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  timestamp: string;
}

type Portal = "cleaner" | "laundry";

type TrackerOptions = {
  portal: Portal;
  /** The job (cleaner) or route (driver) being tracked; empty disables. */
  subjectId: string;
  enabled: boolean;
  /** Cleaner on the way with the client's live-location switch on. */
  clientSees?: boolean;
  /** The server says the window closed: re-ask whether to track. */
  onWindowClosed?: () => void;
};

const ENDPOINT: Record<Portal, string> = {
  cleaner: "/api/cleaner/location/ping",
  laundry: "/api/laundry/location/ping",
};
const ROLE: Record<Portal, string> = { cleaner: "CLEANER", laundry: "LAUNDRY" };

async function readJson(res: { json?: () => Promise<unknown> }): Promise<unknown> {
  if (typeof res.json !== "function") return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function positionToFix(position: GeolocationPosition): LiveFix {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    heading: position.coords.heading ?? null,
    speed: position.coords.speed ?? null,
    measuredAt: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(),
  };
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function useLocationTracker({ portal, subjectId, enabled, clientSees = false, onWindowClosed }: TrackerOptions) {
  const { data: session, status } = useSession();
  const impersonating = Boolean(session?.impersonation);
  const scope = status === "authenticated" && session?.user?.id && session.user.role === ROLE[portal] && !impersonating
    ? JSON.stringify([session.user.id, session.user.role, session.impersonation?.actorId, session.impersonation?.mode, session.impersonation?.startedAt])
    : null;
  const active = enabled && scope !== null && Boolean(subjectId.trim());
  const [permission, setPermission] = useState<GpsPermission>("prompt");
  const [lastFix, setLastFix] = useState<GpsLastFix | null>(null);
  const [restartToken, setRestartToken] = useState(0);

  const lastQueuedRef = useRef<{ lat: number; lng: number; queuedAt: number } | null>(null);
  const lastEnqueueAtRef = useRef(0);
  const lastFixAtRef = useRef<number | null>(null);
  const watchAliveRef = useRef(false);
  const permissionRef = useRef<GpsPermission>("prompt");
  const unavailableRef = useRef(false);
  const flushBusyRef = useRef(false);
  const flushRef = useRef<(options?: { keepalive?: boolean }) => Promise<void>>(async () => {});
  const lastSentStateRef = useRef<TrackingState>("SHARING");
  const pendingStateRef = useRef<TrackingState | null>(null);
  const onWindowClosedRef = useRef(onWindowClosed);
  onWindowClosedRef.current = onWindowClosed;

  /** Recompute the phone's state; queue it for the office when it changed. */
  const noteStateRef = useRef<() => void>(() => {});
  noteStateRef.current = () => {
    const state = trackingStateFor({ permission: permissionRef.current, visible: isVisible(), online: isOnline(), unavailable: unavailableRef.current });
    if (active) updateTrackerStatus({ state });
    if (state === lastSentStateRef.current && pendingStateRef.current === null) return;
    pendingStateRef.current = state;
  };

  // Shared status for the indicator, driving mode and the route screen.
  useEffect(() => {
    if (!active) {
      resetTrackerStatus();
      return;
    }
    updateTrackerStatus({ active: true, portal, clientSees, permission: permissionRef.current, lastFix: null });
    return () => resetTrackerStatus();
  }, [active, portal, clientSees, subjectId, scope]);

  // Capture: seed fix + watch. Restarted on subject/scope change and on demand.
  useEffect(() => {
    lastQueuedRef.current = null;
    lastEnqueueAtRef.current = 0;
    lastFixAtRef.current = null;
    watchAliveRef.current = false;
    unavailableRef.current = false;
    setLastFix(null);
    setPermission("prompt");
    permissionRef.current = "prompt";
    let cancelled = false;
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;

    const accept = async (position: GeolocationPosition, bypassThrottle: boolean) => {
      if (cancelled) return;
      const fix = positionToFix(position);
      setPermission("granted");
      permissionRef.current = "granted";
      unavailableRef.current = false;
      lastFixAtRef.current = Date.now();
      const view: GpsLastFix = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: new Date(fix.measuredAt).toISOString() };
      setLastFix(view);
      updateTrackerStatus({ permission: "granted", lastFix: fix });
      noteStateRef.current();
      const now = Date.now();
      if (!bypassThrottle && !shouldQueueFix(lastQueuedRef.current, fix, now)) return;
      lastQueuedRef.current = { lat: fix.lat, lng: fix.lng, queuedAt: now };
      lastEnqueueAtRef.current = now;
      try {
        await enqueuePing({
          id: newClientPingId(now),
          jobId: portal === "cleaner" ? subjectId : "",
          ...(portal === "laundry" ? { routeId: subjectId } : {}),
          scope: scope!,
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy ?? undefined,
          heading: fix.heading ?? undefined,
          speed: fix.speed ?? undefined,
          timestamp: view.timestamp,
        });
      } catch {
        // IndexedDB unavailable / quota exceeded — best-effort.
      }
    };

    const onError = (err: GeolocationPositionError) => {
      if (cancelled) return;
      if (err.code === err.PERMISSION_DENIED) {
        setPermission("denied");
        permissionRef.current = "denied";
        watchAliveRef.current = false;
        updateTrackerStatus({ permission: "denied" });
      } else {
        unavailableRef.current = true;
      }
      noteStateRef.current();
      if (pendingStateRef.current) void flushRef.current();
    };

    navigator.geolocation.getCurrentPosition(
      (position) => void accept(position, false),
      onError,
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    const id = navigator.geolocation.watchPosition(
      (position) => void accept(position, false),
      onError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    watchAliveRef.current = true;

    return () => {
      cancelled = true;
      watchAliveRef.current = false;
      navigator.geolocation.clearWatch(id);
      lastQueuedRef.current = null;
      lastEnqueueAtRef.current = 0;
    };
  }, [active, portal, subjectId, scope, restartToken]);

  // Flush: interval, reconnect, page hidden / pagehide (keepalive), visible again.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const controller = new AbortController();

    const flush = async (options: { keepalive?: boolean } = {}) => {
      if (cancelled || flushBusyRef.current) return;
      if (!isOnline()) return;
      flushBusyRef.current = true;
      try {
        const pings = (await drainQueue()).filter((ping) => ping.scope === scope);
        if (cancelled) return;
        const state = pendingStateRef.current;
        if (pings.length === 0 && !state) return;
        const batches: Array<typeof pings> = [];
        for (let i = 0; i < pings.length; i += MAX_BATCH) batches.push(pings.slice(i, i + MAX_BATCH));
        if (batches.length === 0) batches.push([]);
        for (let index = 0; index < batches.length; index += 1) {
          if (cancelled) return;
          const batch = batches[index];
          const stateToSend = index === 0 ? state : null;
          const res = await fetch(ENDPOINT[portal], {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: controller.signal,
            ...(options.keepalive ? { keepalive: true } : {}),
            body: JSON.stringify({
              sentAt: new Date().toISOString(),
              // Local queue scope never leaves the device; the queue id becomes the client id.
              pings: batch.map(({ id, scope: _scope, routeId: _routeId, jobId, ...rest }) => ({
                clientId: id,
                ...(portal === "cleaner" ? { jobId } : {}),
                ...rest,
              })),
              ...(stateToSend ? { state: { state: stateToSend, at: new Date().toISOString() } } : {}),
            }),
          });
          if (cancelled) return;
          const verdict = interpretFlushResponse(res.status, await readJson(res));
          if (cancelled) return;
          if (verdict.kind === "retain") return;
          if (batch.length) await clearQueue(batch.map((p) => p.id));
          if (stateToSend) {
            lastSentStateRef.current = stateToSend;
            if (pendingStateRef.current === stateToSend) pendingStateRef.current = null;
          }
          updateTrackerStatus({ lastSentAt: Date.now() });
          if (verdict.arrivedStop) publishRouteArrival(verdict.arrivedStop);
          if (verdict.windowClosed) onWindowClosedRef.current?.();
        }
      } catch {
        // Network or storage error — fixes stay queued.
      } finally {
        flushBusyRef.current = false;
      }
    };
    flushRef.current = flush;

    const interval = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    void flush();
    const onOnline = () => {
      noteStateRef.current();
      void flush();
    };
    const onOffline = () => noteStateRef.current();
    const onVisibility = () => {
      noteStateRef.current();
      if (isVisible()) {
        void flush();
        if (shouldRestartWatch({ visible: true, watchAlive: watchAliveRef.current, lastFixAt: lastFixAtRef.current, now: Date.now(), permission: permissionRef.current })) {
          setRestartToken((value) => value + 1);
        }
      } else {
        // The browser may stop this page any moment now: send what is queued
        // and tell the office the app went to the background.
        void flush({ keepalive: true });
      }
    };
    const onPageHide = () => {
      pendingStateRef.current = "BACKGROUND";
      void flush({ keepalive: true });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
      flushRef.current = async () => {};
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, portal, scope, subjectId]);

  // Heartbeat: a fresh fix when nothing was queued for 45 s (never a re-stamp).
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    let pending = false;
    const beat = setInterval(() => {
      if (cancelled || pending || Date.now() - lastEnqueueAtRef.current < HEARTBEAT_INTERVAL_MS) return;
      pending = true;
      navigator.geolocation.getCurrentPosition(async (position) => {
        pending = false;
        if (cancelled) return;
        const fix = positionToFix(position);
        const view: GpsLastFix = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, timestamp: new Date(fix.measuredAt).toISOString() };
        setLastFix(view);
        lastFixAtRef.current = Date.now();
        lastQueuedRef.current = { lat: fix.lat, lng: fix.lng, queuedAt: Date.now() };
        lastEnqueueAtRef.current = Date.now();
        updateTrackerStatus({ lastFix: fix });
        try {
          await enqueuePing({
            id: newClientPingId(Date.now()),
            jobId: portal === "cleaner" ? subjectId : "",
            ...(portal === "laundry" ? { routeId: subjectId } : {}),
            scope: scope!,
            lat: fix.lat,
            lng: fix.lng,
            accuracy: fix.accuracy ?? undefined,
            timestamp: view.timestamp,
          });
        } catch { /* Offline queue unavailable; the next genuine fix retries. */ }
      }, () => { pending = false; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 });
    }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(beat); };
  }, [active, portal, subjectId, scope]);

  // Permission changes: restart when granted again, report when turned off.
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    let statusHandle: PermissionStatus | null = null;
    const onChange = () => {
      if (cancelled || !statusHandle) return;
      if (statusHandle.state === "granted" && permissionRef.current !== "granted") {
        setRestartToken((value) => value + 1);
      } else if (statusHandle.state === "denied") {
        setPermission("denied");
        permissionRef.current = "denied";
        updateTrackerStatus({ permission: "denied" });
        noteStateRef.current();
        void flushRef.current();
      }
    };
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((handle) => {
        if (cancelled) return;
        statusHandle = handle;
        handle.addEventListener?.("change", onChange);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      statusHandle?.removeEventListener?.("change", onChange);
    };
  }, [active]);

  // "Retry location" from anywhere on the page.
  useEffect(() => {
    if (!active) return;
    return subscribeTrackerRestart(() => setRestartToken((value) => value + 1));
  }, [active]);

  return { permission, lastFix };
}

/** Cleaner tracker (the job they are on the way to or clocked in on). */
export function useGpsTracker({ jobId, enabled = true, clientSees = false, onWindowClosed }: { jobId: string; enabled?: boolean; clientSees?: boolean; onWindowClosed?: () => void }) {
  return useLocationTracker({ portal: "cleaner", subjectId: jobId, enabled, clientSees, onWindowClosed });
}

/** Laundry driver tracker (their ACTIVE route today). */
export function useRouteTracker({ routeId, enabled = true, onWindowClosed }: { routeId: string; enabled?: boolean; onWindowClosed?: () => void }) {
  return useLocationTracker({ portal: "laundry", subjectId: routeId, enabled, onWindowClosed });
}
