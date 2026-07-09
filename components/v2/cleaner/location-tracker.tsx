"use client";

/**
 * Persistent, layout-level live-location tracker for cleaners.
 *
 * Mounted once in the cleaner portal layout so GPS tracking is a property of
 * "this cleaner has an active job", NOT "this cleaner has the driving/workspace
 * screen open". It polls a lightweight probe for the current EN_ROUTE /
 * IN_PROGRESS / PAUSED job and, whenever one exists, runs the shared
 * `useGpsTracker` watch + heartbeat against it — resuming automatically on page
 * load / navigation and standing down the moment the job is submitted/completed.
 *
 * It is intentionally invisible; the per-screen surfaces (driving mode, job
 * workspace) keep their own richer UI + ETA pings. This just guarantees the
 * background location feed never drops mid-job.
 */

import { useEffect, useState } from "react";
import { useGpsTracker } from "@/lib/gps/client";

const PROBE_INTERVAL_MS = 60_000;

type ActiveJob = { id: string; status: string } | null;

export function LocationTracker() {
  const [activeJob, setActiveJob] = useState<ActiveJob>(null);

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const res = await fetch("/api/cleaner/location/active-job", {
          cache: "no-store",
          headers: { "x-progress-toast": "off" },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json().catch(() => ({ job: null }))) as { job: ActiveJob };
        if (cancelled) return;
        setActiveJob((prev) => {
          const next = data.job;
          // Avoid churn: only update when the tracked job id actually changes.
          if (prev?.id === next?.id && prev?.status === next?.status) return prev;
          return next;
        });
      } catch {
        // transient — next tick retries; keep tracking the last known job.
      }
    }

    void probe();
    const id = setInterval(probe, PROBE_INTERVAL_MS);
    // Re-probe when the tab regains focus (cleaner comes back to the app).
    const onVisible = () => {
      if (document.visibilityState === "visible") void probe();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Hook must be called unconditionally; `enabled` gates the actual watch.
  useGpsTracker({ jobId: activeJob?.id ?? "", enabled: Boolean(activeJob?.id) });

  return null;
}
