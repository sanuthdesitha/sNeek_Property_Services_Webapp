"use client";

/**
 * Stage 2 — Get there. A single-job travel card: a big Navigate button, a
 * prominent link to the live "On the way" route surface (which owns the GPS
 * heartbeat + ETA optimiser — we deliberately do NOT rebuild it here), the
 * current ETA when the job already carries one, and an "I've arrived" action
 * that advances to Set up.
 */
import * as React from "react";
import Link from "next/link";
import { Navigation, Clock, Route, Flag, MapPin } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

export function StageTravel({ api }: { api: WorkspaceApi }) {
  const { job, navUrl, addressLine, propertyCode } = api;
  const enRouteActive = Boolean(job?.enRouteStartedAt) && !job?.arrivedAt;
  const eta = job?.enRouteEtaMinutes;

  return (
    <div className="space-y-5">
      <ECard variant="ceremony">
        <ECardBody className="space-y-4 pt-6">
          <div className="flex items-center justify-between gap-2">
            <p className="e-eyebrow">On the way</p>
            {enRouteActive ? (
              <EBadge tone="info" soft>
                En route
              </EBadge>
            ) : null}
          </div>

          <div>
            <p className="e-display-sm">{propertyCode || "Next stop"}</p>
            <p className="mt-1 flex items-start gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {addressLine || "Address not set"}
            </p>
          </div>

          {enRouteActive && eta != null ? (
            <div className="inline-flex items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.875rem] font-[550]">
              <Clock className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" /> ETA {eta} min
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {navUrl ? (
              <a href={navUrl} target="_blank" rel="noreferrer">
                <EButton variant="gold">
                  <Navigation className="h-4 w-4" /> Navigate
                </EButton>
              </a>
            ) : null}
            <EButton variant="primary" onClick={() => api.setActiveStage(3)}>
              <Flag className="h-4 w-4" /> I&apos;ve arrived
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      {/* Live location sharing + the multi-stop optimiser live on the route
          page — link out rather than duplicate the heartbeat/ETA engine. */}
      <ECard>
        <ECardBody className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
              <Route className="h-4 w-4" /> Share your live location
            </p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Start &quot;On the way&quot; on your route to send the office a live ETA and let the guest know you&apos;re coming.
            </p>
          </div>
          <Link href="/v2/cleaner/route">
            <EButton variant="outline">
              <Route className="h-4 w-4" /> Open route
            </EButton>
          </Link>
        </ECardBody>
      </ECard>
    </div>
  );
}
