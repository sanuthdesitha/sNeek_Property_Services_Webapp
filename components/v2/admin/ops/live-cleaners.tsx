"use client";

/**
 * ESTATE live-cleaner list — the same /api/admin/live-locations feed the
 * legacy live map consumes, rendered as an Estate list (no map mount).
 * Polls every 15s. The full classic map stays at /admin/ops/map.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MapPinned, RadioTower } from "lucide-react";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";

const POLL_INTERVAL_MS = 15_000;

type LiveLocation = {
  jobId: string;
  jobNumber?: number | string | null;
  jobType?: string | null;
  cleanerName: string;
  lastPingAt?: string | null;
  propertyName?: string | null;
  etaMinutes?: number | null;
  arrivedAt?: string | null;
  drivingPausedAt?: string | null;
  drivingDelayedAt?: string | null;
};

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function tripState(loc: LiveLocation): { label: string; tone: Tone } {
  if (loc.arrivedAt) return { label: "On site", tone: "success" };
  if (loc.drivingPausedAt) return { label: "Trip paused", tone: "neutral" };
  if (loc.drivingDelayedAt) return { label: "Delayed", tone: "warning" };
  return { label: "En route", tone: "info" };
}

function relativePing(iso?: string | null) {
  if (!iso) return "no ping yet";
  const deltaMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
}

function formatEta(minutes?: number | null) {
  if (minutes == null) return null;
  if (minutes < 1) return "Arriving now";
  return `ETA ${Math.round(minutes)} min`;
}

export function LiveCleaners({ mapDate }: { mapDate: string }) {
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchLocations() {
    try {
      const res = await fetch("/api/admin/live-locations", {
        cache: "no-store",
        headers: { "x-progress-toast": "off" },
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json().catch(() => []);
      setLocations(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void fetchLocations();
    intervalRef.current = setInterval(fetchLocations, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <ECard>
      <ECardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <ECardTitle className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" aria-hidden />
            Active cleaners
          </ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Cleaners currently driving or on site
            {lastUpdated ? ` · updated ${relativePing(lastUpdated.toISOString())} · refreshes every 15s` : ""}.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <EBadge tone="success" soft>
            {locations.length} live
          </EBadge>
          <Link
            href={`/v2/admin/ops/map?date=${mapDate}`}
            className="inline-flex items-center gap-1 text-[0.8125rem] font-[550] text-[hsl(var(--e-gold-ink))] underline-offset-4 hover:underline"
          >
            <MapPinned className="h-3.5 w-3.5" aria-hidden /> Live map
          </Link>
        </div>
      </ECardHeader>
      <ECardBody className="pt-0">
        {error ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Could not load live locations.</p>
        ) : locations.length === 0 ? (
          <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            No cleaners are live right now. They appear here while en route or during a clean.
          </p>
        ) : (
          <div className="space-y-3">
            {locations.map((loc) => {
              const state = tripState(loc);
              const eta = formatEta(loc.etaMinutes);
              return (
                <Link
                  key={loc.jobId}
                  href={`/v2/admin/jobs/${loc.jobId}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3 transition-colors hover:bg-[hsl(var(--e-muted))]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.8125rem] font-[550]">{loc.cleanerName}</p>
                      <EBadge tone={state.tone} soft>{state.label}</EBadge>
                      {eta && !loc.arrivedAt ? <EBadge tone="warning">{eta}</EBadge> : null}
                    </div>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {loc.propertyName ?? "Property"}
                      {loc.jobNumber ? ` · #${loc.jobNumber}` : ""}
                      {loc.jobType ? ` · ${String(loc.jobType).replace(/_/g, " ")}` : ""}
                    </p>
                  </div>
                  <p className="e-tnum shrink-0 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    Ping {relativePing(loc.lastPingAt)}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </ECardBody>
    </ECard>
  );
}
