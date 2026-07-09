"use client";

/**
 * ESTATE live-cleaner list. Reads the enriched ops snapshot
 * (/api/admin/ops/live-locations) — the same feed the ops map uses — so a
 * cleaner with an active EN_ROUTE / IN_PROGRESS / PAUSED job stays listed even
 * when their last GPS ping is stale, and genuinely stale dots are flagged.
 * Polls every 15s.
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

type LivePing = {
  userId: string;
  user?: { name?: string | null } | null;
  liveStatus?: "EN_ROUTE" | "ON_SITE" | "IDLE";
  lastPingAt?: string | null;
  timestamp?: string | null;
  stale?: boolean;
  positionSource?: "gps" | "property" | "none";
  activeJob?: {
    id: string;
    jobNumber: string | number | null;
    status: string;
    propertyName: string;
    etaMinutes: number | null;
  } | null;
  timer?: { startedAt: string; elapsedMinutes: number } | null;
};

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function stateLabel(loc: LivePing): { label: string; tone: Tone } {
  if (loc.liveStatus === "ON_SITE") return { label: "On site", tone: "success" };
  if (loc.liveStatus === "EN_ROUTE") return { label: "En route", tone: "info" };
  return { label: "Active", tone: "neutral" };
}

function cleanerName(loc: LivePing): string {
  return loc.user?.name ?? loc.userId.slice(0, 8);
}

function relativePing(iso?: string | null) {
  if (!iso) return "no GPS yet";
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "no GPS yet";
  const minutes = Math.floor((Date.now() - ms) / 60_000);
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
  const [locations, setLocations] = useState<LivePing[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchLocations() {
    try {
      const res = await fetch("/api/admin/ops/live-locations", {
        cache: "no-store",
        headers: { "x-progress-toast": "off" },
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      const data = await res.json().catch(() => ({ pings: [] }));
      setLocations(Array.isArray(data?.pings) ? data.pings : []);
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
            Everyone currently driving or on site
            {lastUpdated ? ` · updated ${relativePing(lastUpdated.toISOString())} · refreshes every 15s` : ""}.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <EBadge tone={locations.length > 0 ? "success" : "neutral"} soft>
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
              const state = stateLabel(loc);
              const eta = loc.liveStatus === "EN_ROUTE" ? formatEta(loc.activeJob?.etaMinutes) : null;
              const href = loc.activeJob ? `/v2/admin/jobs/${loc.activeJob.id}` : `/v2/admin/ops/map?date=${mapDate}`;
              return (
                <Link
                  key={loc.userId}
                  href={href}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3 transition-colors hover:bg-[hsl(var(--e-muted))]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.8125rem] font-[550]">{cleanerName(loc)}</p>
                      <EBadge tone={state.tone} soft>{state.label}</EBadge>
                      {eta ? <EBadge tone="warning">{eta}</EBadge> : null}
                      {loc.timer ? (
                        <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                          elapsed {Math.floor(loc.timer.elapsedMinutes / 60) > 0 ? `${Math.floor(loc.timer.elapsedMinutes / 60)}h ` : ""}
                          {loc.timer.elapsedMinutes % 60}m
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {loc.activeJob?.propertyName ?? "No active job"}
                      {loc.activeJob?.jobNumber ? ` · #${loc.activeJob.jobNumber}` : ""}
                    </p>
                  </div>
                  <p
                    className={`e-tnum shrink-0 text-[0.75rem] ${
                      loc.positionSource === "property" || loc.stale
                        ? "text-[hsl(var(--e-danger))]"
                        : "text-[hsl(var(--e-text-faint))]"
                    }`}
                  >
                    {loc.positionSource === "property"
                      ? "No GPS · at address"
                      : `Ping ${relativePing(loc.lastPingAt ?? loc.timestamp)}${loc.stale ? " · stale" : ""}`}
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
