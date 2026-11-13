"use client";

/**
 * The laundry driver's tracker, mounted by the laundry portal layout so it
 * runs on every screen of the portal while the driver's route is ACTIVE today
 * (it used to run only while the route page was open, with no queue, no
 * heartbeat, and it stopped for good on any GPS error). Asks
 * GET /api/laundry/location/active-route every 60 s, on focus and when the
 * page becomes visible; any failure stops tracking until the next answer.
 */
import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouteTracker } from "@/lib/gps/client";
import { LocationSharingIndicator } from "@/components/v2/location/location-sharing-indicator";

const PROBE_INTERVAL_MS = 60_000;

/** Pure: read the probe's answer (anything malformed means "do not track"). */
export function parseRouteTracking(value: unknown): { active: true; routeId: string } | { active: false } {
  if (!value || typeof value !== "object") return { active: false };
  const tracking = (value as { tracking?: { active?: unknown; routeId?: unknown } }).tracking;
  if (!tracking || tracking.active !== true || typeof tracking.routeId !== "string" || !tracking.routeId.trim()) return { active: false };
  return { active: true, routeId: tracking.routeId };
}

export function DriverLocationTracker() {
  const { data: session, status } = useSession();
  const isDriver = status === "authenticated" && session?.user?.role === "LAUNDRY" && !session.impersonation;
  const [routeId, setRouteId] = React.useState<string | null>(null);
  const refreshRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!isDriver) {
      setRouteId(null);
      return;
    }
    let disposed = false;
    let controller: AbortController | null = null;
    const probe = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        const res = await fetch("/api/laundry/location/active-route", { cache: "no-store", signal: current.signal, headers: { "x-progress-toast": "off" } });
        const body: unknown = res.ok ? await res.json() : null;
        if (disposed || current.signal.aborted) return;
        const tracking = parseRouteTracking(body);
        setRouteId(tracking.active ? tracking.routeId : null);
      } catch {
        if (!disposed && !current.signal.aborted) setRouteId(null);
      }
    };
    refreshRef.current = () => void probe();
    void probe();
    const id = window.setInterval(() => void probe(), PROBE_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void probe(); };
    const onRouteChanged = () => void probe();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("sneek:laundry-route-changed", onRouteChanged);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(id);
      refreshRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("sneek:laundry-route-changed", onRouteChanged);
    };
  }, [isDriver, session?.user?.id]);

  useRouteTracker({ routeId: routeId ?? "", enabled: Boolean(routeId), onWindowClosed: () => refreshRef.current() });
  return <LocationSharingIndicator />;
}
