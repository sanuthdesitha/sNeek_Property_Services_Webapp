"use client";

/**
 * ESTATE live-cleaner list. Reads the enriched ops snapshot
 * (/api/admin/ops/live-locations) — the same feed the ops map uses — so a
 * cleaner with an active EN_ROUTE / IN_PROGRESS / PAUSED job stays listed even
 * when their last GPS ping is stale, and genuinely stale dots are flagged.
 * Polls every 15s.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPinned, RadioTower } from "lucide-react";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { formatRelativeAgo } from "@/lib/ops/live-status";

const POLL_INTERVAL_MS = 15_000;

type LivePing = {
  userId: string;
  user?: { name?: string | null } | null;
  liveStatus?:
    | "ON_SITE"
    | "OFF_SITE"
    | "NO_SIGNAL"
    | "PAUSED"
    | "LEFT_SITE"
    | "EN_ROUTE"
    | "IDLE";
  liveLabel?: string | null;
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

type Tone =
  | "neutral"
  | "primary"
  | "gold"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "aubergine";

const STATUS_TONE: Record<string, Tone> = {
  ON_SITE: "success",
  EN_ROUTE: "info",
  OFF_SITE: "warning",
  NO_SIGNAL: "danger",
  PAUSED: "gold",
  LEFT_SITE: "danger",
  IDLE: "neutral",
};

const STATUS_FALLBACK_LABEL: Record<string, string> = {
  ON_SITE: "On site",
  EN_ROUTE: "En route",
  OFF_SITE: "Clocked in · off site",
  NO_SIGNAL: "Clocked in · no signal",
  PAUSED: "Paused",
  LEFT_SITE: "Left site",
  IDLE: "Idle",
};

function stateLabel(loc: LivePing): { label: string; tone: Tone } {
  const status = loc.liveStatus ?? "IDLE";
  return {
    label: loc.liveLabel ?? STATUS_FALLBACK_LABEL[status] ?? "Active",
    tone: STATUS_TONE[status] ?? "neutral",
  };
}

function cleanerName(loc: LivePing): string {
  return loc.user?.name ?? loc.userId.slice(0, 8);
}

// Shared relative-age formatting (same helper the server derivation uses).
const relativePing = (iso?: string | null) => formatRelativeAgo(iso ?? null);

function formatEta(minutes?: number | null) {
  if (minutes == null) return null;
  if (minutes < 1) return "Arriving now";
  return `ETA ${Math.round(minutes)} min`;
}

export function LiveCleaners({ mapDate }: { mapDate: string }) {
  const [locations, setLocations] = useState<LivePing[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/admin/ops/live-locations", {
          cache: "no-store",
          signal: controller.signal,
          headers: { "x-progress-toast": "off" },
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.pings))
          throw new Error("Locations unavailable");
        if (controller.signal.aborted) return;
        setLocations(data.pings);
        setLastUpdated(new Date());
        setError(false);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <ECard>
      <ECardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <ECardTitle className="flex items-center gap-2">
            <RadioTower
              className="h-4 w-4 text-[hsl(var(--e-accent-portal))]"
              aria-hidden
            />
            Active cleaners
          </ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Everyone currently driving or on site
            {lastUpdated
              ? ` · updated ${relativePing(lastUpdated.toISOString())} · refreshes every 15s`
              : ""}
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <EBadge tone={locations.length > 0 ? "success" : "neutral"} soft>
            {locations.length} tracked
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
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Could not refresh locations. Last received data may be out of date.
          </p>
        ) : locations.length === 0 ? (
          <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            No cleaners are live right now. They appear here while en route or
            during a clean.
          </p>
        ) : (
          <div className="space-y-3">
            {locations.map((loc) => {
              const state = stateLabel(loc);
              const eta =
                loc.liveStatus === "EN_ROUTE"
                  ? formatEta(loc.activeJob?.etaMinutes)
                  : null;
              const href = loc.activeJob
                ? `/v2/admin/jobs/${loc.activeJob.id}`
                : `/v2/admin/ops/map?date=${mapDate}`;
              return (
                <Link
                  key={loc.userId}
                  href={href}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-3 transition-colors hover:bg-[hsl(var(--e-muted))]"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.8125rem] font-[550]">
                        {cleanerName(loc)}
                      </p>
                      <EBadge tone={state.tone} soft>
                        {state.label}
                      </EBadge>
                      {eta ? <EBadge tone="warning">{eta}</EBadge> : null}
                      {loc.timer ? (
                        <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                          elapsed{" "}
                          {Math.floor(loc.timer.elapsedMinutes / 60) > 0
                            ? `${Math.floor(loc.timer.elapsedMinutes / 60)}h `
                            : ""}
                          {loc.timer.elapsedMinutes % 60}m
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {loc.activeJob?.propertyName ?? "No active job"}
                      {loc.activeJob?.jobNumber
                        ? ` · #${loc.activeJob.jobNumber}`
                        : ""}
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
