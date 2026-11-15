"use client";

/**
 * The job screen's bottom action bar (board "One job, four moments": the tab
 * bar hides inside a job and the bottom button is always the next step).
 *
 *   Get there → Back / Next: Set up
 *   Set up    → Clock in and start (or Resume timer), with the reason it is
 *               not available yet; Next: Clean once clocked in
 *   Clean     → Back / Next: Wrap up
 *
 * Accept drives itself and Wrap up puts Submit in its own bar. Reachability and
 * the clock-in handler come from the workspace unchanged: this is placement.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, Play } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { JOB_STAGE_LABELS, type JobStage } from "@/lib/cleaner/job-stage";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";
import { cn } from "@/lib/utils";

/** Sticky bottom container shared by the stage footers and Wrap up's submit. */
export function StickyActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 space-y-1.5 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 lg:mx-0 lg:rounded-[var(--e-radius-lg)] lg:border",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Why the clock-in button is not available, in the cleaner's terms. */
export function clockInBlockedReason(api: Pick<WorkspaceApi, "clockInDisabled" | "startGateBlocks" | "propertyCodeConfirmed" | "laundryBagConfirmRequired" | "laundryBagConfirmed">): string | null {
  if (!api.clockInDisabled) return null;
  const boxesTicked = api.propertyCodeConfirmed && (!api.laundryBagConfirmRequired || api.laundryBagConfirmed);
  if (api.startGateBlocks && !boxesTicked) {
    return api.laundryBagConfirmRequired ? "Tick both boxes above first." : "Tick the box above first.";
  }
  return "Clock in needs a connection. Try again when you have signal.";
}

function SetupClockIn({ api }: { api: WorkspaceApi }) {
  const resume = api.ownStarted || (api.hasCheckin && !api.startGateBlocks);
  const busy = api.busy === "clockin" || api.busy === "clockIn";
  const reason = clockInBlockedReason(api);
  return (
    <>
      <EButton {...tourTarget("cleaner.job.checkIn")} variant="gold" className="min-h-11 w-full" disabled={busy || api.clockInDisabled} onClick={() => api.clockIn()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
        {resume ? "Resume timer" : "Clock in and start"}
      </EButton>
      <p {...tourTarget("cleaner.job.locationNotice")} className="text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {reason ?? (resume ? "Resuming restarts your timer only." : "Clock in records your time and location.")}
      </p>
    </>
  );
}

export function StageFooterNav({ api }: { api: WorkspaceApi }) {
  const { activeStage, setActiveStage, needsAcceptance, hasStarted, locked } = api;

  // Only the three middle stages (Get there / Set up / Clean) get the footer.
  if (locked || needsAcceptance || activeStage < 2 || activeStage > 4) return null;

  const next = (activeStage + 1) as JobStage;
  const prev = (activeStage - 1) as JobStage;
  const prevReachable = prev >= 2; // stage 1 (Accept) is done once accepted
  // Clean (4) is only reachable once the cleaner has clocked in.
  const nextNeedsClockIn = next === 4 && !hasStarted;

  return (
    <StickyActionBar>
      {nextNeedsClockIn ? (
        <SetupClockIn api={api} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          {prevReachable ? (
            <EButton variant="ghost" className="min-h-11" onClick={() => setActiveStage(prev)}>
              <ChevronLeft className="h-4 w-4" /> Back
            </EButton>
          ) : (
            <span />
          )}
          <EButton variant="primary" className="min-h-11 flex-1 sm:flex-none" onClick={() => setActiveStage(next)}>
            Next: {JOB_STAGE_LABELS[next]} <ChevronRight className="h-4 w-4" />
          </EButton>
        </div>
      )}
    </StickyActionBar>
  );
}
