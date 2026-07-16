"use client";

/**
 * The 5-step journey rail. Numbered steps with labels; the active stage is
 * highlighted, completed stages show a tick, and any reachable stage is tappable
 * (you can always go back). Guards: stages 4/5 need the cleaner to have clocked
 * in. Stage 1 (Accept) is hidden entirely once the job is accepted, leaving a
 * 4-step rail.
 */
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOB_STAGE_LABELS, type JobStage } from "@/lib/cleaner/job-stage";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

export function StageNav({ api }: { api: WorkspaceApi }) {
  const { activeStage, setActiveStage, needsAcceptance, hasStarted, locked } = api;

  const stages: JobStage[] = needsAcceptance ? [1, 2, 3, 4, 5] : [2, 3, 4, 5];

  const isReachable = (stage: JobStage): boolean => {
    if (stage === 1) return needsAcceptance;
    if (needsAcceptance) return false; // must accept first
    if (stage === 4 || stage === 5) return hasStarted;
    return true; // 2 (Get there) + 3 (Set up) always reachable once accepted
  };

  const isComplete = (stage: JobStage): boolean => {
    if (stage === 1) return !needsAcceptance;
    if (stage === 2 || stage === 3) return hasStarted;
    if (stage === 4) return locked;
    return false;
  };

  return (
    <nav aria-label="Job progress" className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
      {stages.map((stage, i) => {
        const active = stage === activeStage;
        const complete = isComplete(stage);
        const reachable = isReachable(stage);
        return (
          <button
            key={stage}
            type="button"
            disabled={!reachable}
            onClick={() => reachable && setActiveStage(stage)}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[var(--e-radius)] border px-1.5 py-2 text-center transition-colors",
              active
                ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                : complete
                  ? "border-[hsl(var(--e-success)/0.4)] bg-[hsl(var(--e-surface))]"
                  : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
              !reachable && "opacity-45"
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[0.75rem] font-[600] tabular-nums",
                active
                  ? "bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]"
                  : complete
                    ? "bg-[hsl(var(--e-success))] text-[hsl(var(--e-success-foreground))]"
                    : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
              )}
            >
              {complete && !active ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "truncate text-[0.6875rem] font-[550] leading-tight",
                active ? "text-[hsl(var(--e-foreground))]" : "text-[hsl(var(--e-muted-foreground))]"
              )}
            >
              {JOB_STAGE_LABELS[stage]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
