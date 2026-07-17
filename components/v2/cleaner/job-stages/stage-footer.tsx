"use client";

/**
 * Shared per-stage footer navigation for the cleaner job journey. Gives every
 * middle step (Get there → Set up → Clean) an explicit Back / Next control that
 * mirrors the StageNav reachability rules, so cleaners can always move forward
 * without hunting for the stage-specific CTA. Rendered by job-workspace under
 * the active stage. Not shown on Accept (the Accept card drives progression) or
 * Wrap up (terminal — it ends in Submit).
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { JOB_STAGE_LABELS, type JobStage } from "@/lib/cleaner/job-stage";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

export function StageFooterNav({ api }: { api: WorkspaceApi }) {
  const { activeStage, setActiveStage, needsAcceptance, hasStarted, locked } = api;

  // Only the three middle stages (Get there / Set up / Clean) get the footer.
  // Accept (1) has its own continue button; Wrap up (5) ends in Submit.
  if (locked || needsAcceptance || activeStage < 2 || activeStage > 4) return null;

  const next = (activeStage + 1) as JobStage;
  const prev = (activeStage - 1) as JobStage;
  const prevReachable = prev >= 2; // stage 1 (Accept) is hidden once accepted
  // Clean (4) is only reachable once the cleaner has clocked in.
  const nextNeedsClockIn = next === 4 && !hasStarted;

  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      {prevReachable ? (
        <EButton variant="ghost" onClick={() => setActiveStage(prev)}>
          <ChevronLeft className="h-4 w-4" /> Back
        </EButton>
      ) : (
        <span />
      )}
      {nextNeedsClockIn ? (
        <EButton variant="primary" disabled title="Clock in on Set up to start cleaning">
          Clock in to continue <Lock className="h-4 w-4" />
        </EButton>
      ) : (
        <EButton variant="primary" onClick={() => setActiveStage(next)}>
          Next: {JOB_STAGE_LABELS[next]} <ChevronRight className="h-4 w-4" />
        </EButton>
      )}
    </div>
  );
}
