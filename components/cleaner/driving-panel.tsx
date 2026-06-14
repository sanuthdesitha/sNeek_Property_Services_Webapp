"use client";

/**
 * DrivingPanel — the cleaner's en-route control surface.
 *
 * This is a PRESENTATIONAL component: every API call, GPS watch, timer and bit
 * of business logic stays in the job page. The panel only renders state and
 * calls back the handlers it is given, so the existing contracts
 * (start-driving / pause / resume / arrived / location-ping / mark-delayed)
 * are untouched — we only make the experience clearer and easier.
 *
 * UX goals:
 *  - A prominent current-state stepper (On the way → Arrived) so the cleaner
 *    always knows where they are in the trip.
 *  - One big primary action for the obvious next step.
 *  - Quick reason chips for Pause / Running late (Traffic, Fuel, Break, …).
 *  - Live ETA + last-ping freshness.
 *  - One-tap "Navigate" that opens Google Maps directions to the property.
 *  - Mobile-first, large touch targets.
 */

import * as React from "react";
import {
  Navigation,
  MapPin,
  PauseCircle,
  TimerReset,
  TrafficCone,
  Square,
  Fuel,
  Coffee,
  ParkingCircle,
  Hourglass,
  CircleDot,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type DrivingTripState = "EN_ROUTE" | "PAUSED" | "DELAYED" | "ARRIVED";

export interface DrivingReasonOption {
  value: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

/**
 * Shared quick-reason chips for both Pause and Running-late. These map onto the
 * existing free-text reason field — the API already accepts any string — so we
 * stay inside the current contract while giving cleaners fast, consistent taps.
 */
export const DRIVING_REASON_OPTIONS: DrivingReasonOption[] = [
  { value: "Traffic", label: "Traffic", Icon: TrafficCone },
  { value: "Fuel", label: "Fuel", Icon: Fuel },
  { value: "Break", label: "Break", Icon: Coffee },
  { value: "Previous job ran over", label: "Previous job ran over", Icon: Hourglass },
  { value: "Parking", label: "Parking", Icon: ParkingCircle },
];

interface DrivingPanelProps {
  tripState: DrivingTripState;
  etaLabel: string;
  lastUpdateLabel: string | null;
  trackingLabel: string; // "Active" | "Stopped" | "Starting"
  trackingActive: boolean;
  pingFreshnessLabel: string | null;
  trackingError: string | null;
  pauseReason: string | null;
  delayReason: string | null;

  // Capability gates (computed in the page from real job state).
  canPause: boolean;
  canResume: boolean;
  canArrive: boolean;

  // Busy flags.
  pausing: boolean;
  resuming: boolean;
  arriving: boolean;
  stopping: boolean;
  markingDelayed: boolean;

  // Selected reasons (controlled by the page so its handlers can read them).
  pauseReasonValue: string;
  onPauseReasonChange: (value: string) => void;
  delayReasonValue: string;
  onDelayReasonChange: (value: string) => void;

  // Manual-ETA entry (shown only when no ETA is known yet).
  showManualEta: boolean;
  manualEta: string;
  onManualEtaChange: (value: string) => void;
  onSetManualEta: () => void;

  // Navigation deep link to the property.
  navigateUrl: string | null;

  // Actions — these wrap the existing fetch handlers in the page.
  onPause: () => void;
  onResume: () => void;
  onArrived: () => void;
  onStop: () => void;
  onMarkDelayed: () => void;
  onRetryGps: () => void;
}

const STEPPER: Array<{ key: DrivingTripState; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { key: "EN_ROUTE", label: "On the way", Icon: Navigation },
  { key: "PAUSED", label: "Paused", Icon: PauseCircle },
  { key: "ARRIVED", label: "Arrived", Icon: CheckCircle2 },
];

function ReasonChips({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DRIVING_REASON_OPTIONS.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.Icon;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted",
              disabled && "cursor-not-allowed opacity-50"
            )}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function DrivingPanel(props: DrivingPanelProps) {
  const {
    tripState,
    etaLabel,
    lastUpdateLabel,
    trackingLabel,
    trackingActive,
    pingFreshnessLabel,
    trackingError,
    pauseReason,
    delayReason,
    canPause,
    canResume,
    canArrive,
    pausing,
    resuming,
    arriving,
    stopping,
    markingDelayed,
    pauseReasonValue,
    onPauseReasonChange,
    delayReasonValue,
    onDelayReasonChange,
    showManualEta,
    manualEta,
    onManualEtaChange,
    onSetManualEta,
    navigateUrl,
    onPause,
    onResume,
    onArrived,
    onStop,
    onMarkDelayed,
    onRetryGps,
  } = props;

  const arrived = tripState === "ARRIVED";
  const paused = tripState === "PAUSED";

  // Which stepper node is "current".
  const activeStepIndex = arrived ? 2 : paused ? 1 : 0;

  return (
    <Card className="border-warning/40 bg-warning/10">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Navigation className="h-4 w-4" />
            En route
          </span>
          <Badge
            variant={arrived ? "success" : tripState === "DELAYED" ? "warning" : paused ? "secondary" : "outline"}
          >
            {tripState === "DELAYED" ? "Running late" : arrived ? "Arrived" : paused ? "Paused" : "On the way"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current-state stepper */}
        <ol className="flex items-center gap-1" aria-label="Trip progress">
          {STEPPER.map((node, i) => {
            const Icon = node.Icon;
            const done = i < activeStepIndex;
            const current = i === activeStepIndex;
            return (
              <React.Fragment key={node.key}>
                <li className="flex flex-1 flex-col items-center gap-1 text-center">
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors",
                      done && "border-success bg-success text-success-foreground",
                      current && "border-primary bg-primary text-primary-foreground",
                      !done && !current && "border-border bg-background text-muted-foreground"
                    )}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium leading-tight",
                      current ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {node.label}
                  </span>
                </li>
                {i < STEPPER.length - 1 ? (
                  <span
                    className={cn(
                      "mb-5 h-0.5 flex-1 rounded-full",
                      i < activeStepIndex ? "bg-success" : "bg-border"
                    )}
                    aria-hidden
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </ol>

        {/* Live ETA + ping freshness */}
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border bg-background p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> ETA
            </p>
            <p className="mt-1 text-sm font-semibold">{etaLabel}</p>
            {showManualEta ? (
              <div className="mt-2 flex gap-1">
                <Input
                  type="number"
                  min={1}
                  max={240}
                  placeholder="min"
                  inputMode="numeric"
                  value={manualEta}
                  onChange={(e) => onManualEtaChange(e.target.value)}
                  className="h-9 w-16 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 px-2 text-xs"
                  disabled={!manualEta || Number.isNaN(Number(manualEta))}
                  onClick={onSetManualEta}
                >
                  Set ETA
                </Button>
              </div>
            ) : null}
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <CircleDot className="h-3.5 w-3.5" /> Last update
            </p>
            <p className="mt-1 text-sm font-semibold">{lastUpdateLabel ?? "Waiting for GPS"}</p>
          </div>
          <div className="rounded-lg border bg-background p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Navigation className="h-3.5 w-3.5" /> Tracking
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
              {trackingActive ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden />
              ) : null}
              {trackingLabel}
            </p>
            {trackingActive && pingFreshnessLabel ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{pingFreshnessLabel}</p>
            ) : null}
          </div>
        </div>

        {trackingError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-xs text-foreground">{trackingError}</p>
            <Button type="button" size="sm" variant="outline" className="h-9" onClick={onRetryGps}>
              Retry GPS
            </Button>
          </div>
        ) : null}

        {pauseReason ? (
          <div className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xs text-foreground/80">
            Paused — {pauseReason}
          </div>
        ) : null}
        {delayReason ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
            Client notified you&apos;re running late — {delayReason}
          </div>
        ) : null}

        {/* Primary next-step action: Navigate + Arrived (or Resume when paused) */}
        {!arrived ? (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              {navigateUrl ? (
                <Button
                  asChild
                  variant="outline"
                  className="h-14 flex-1 text-base"
                >
                  <a href={navigateUrl} target="_blank" rel="noreferrer">
                    <Navigation className="mr-2 h-5 w-5" />
                    Navigate
                  </a>
                </Button>
              ) : null}
              {canResume ? (
                <Button
                  type="button"
                  className="h-14 flex-1 text-base"
                  disabled={resuming}
                  onClick={onResume}
                >
                  <TimerReset className="mr-2 h-5 w-5" />
                  {resuming ? "Resuming…" : "Resume driving"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-14 flex-1 text-base"
                  disabled={!canArrive || arriving}
                  onClick={onArrived}
                >
                  <MapPin className="mr-2 h-5 w-5" />
                  {arriving ? "Saving…" : "I've arrived"}
                </Button>
              )}
            </div>
            {/* When paused, still surface Arrived as a secondary so they aren't stuck. */}
            {canResume && canArrive ? (
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full"
                disabled={arriving}
                onClick={onArrived}
              >
                <MapPin className="mr-2 h-4 w-4" />
                {arriving ? "Saving…" : "I've arrived"}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-3 text-sm font-medium text-foreground">
            <CheckCircle2 className="h-5 w-5 text-success" />
            You&apos;ve arrived. Start the job below when you&apos;re ready.
          </div>
        )}

        {/* Secondary controls: pause + running-late with quick reason chips */}
        {!arrived ? (
          <div className="space-y-3 rounded-lg border bg-background p-3">
            {canPause ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Need to pause? Pick a reason</p>
                <ReasonChips value={pauseReasonValue} onChange={onPauseReasonChange} disabled={pausing} />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={!canPause || pausing || !pauseReasonValue.trim()}
                  onClick={onPause}
                >
                  <PauseCircle className="mr-2 h-4 w-4" />
                  {pausing ? "Pausing…" : "Pause driving"}
                </Button>
              </div>
            ) : null}

            {canArrive ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Running late? Let the client know</p>
                <ReasonChips value={delayReasonValue} onChange={onDelayReasonChange} disabled={markingDelayed} />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full"
                  disabled={markingDelayed || !delayReasonValue.trim()}
                  onClick={onMarkDelayed}
                >
                  <TrafficCone className="mr-2 h-4 w-4" />
                  {markingDelayed ? "Sending…" : "Tell client I'm running late"}
                </Button>
              </div>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full text-muted-foreground"
              disabled={stopping}
              onClick={onStop}
            >
              <Square className="mr-2 h-4 w-4" />
              {stopping ? "Stopping…" : "Stop driving"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default DrivingPanel;
