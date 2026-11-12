"use client";

/**
 * The five-step journey rail (board "One job, four moments": "✓ Accept ✓ Get
 * there 3 Set up 4 Clean 5 Wrap up"). Done steps show a tick, the current step
 * is highlighted and every reachable step is tappable (you can always go back).
 *
 * Reachability is unchanged: stages 4/5 need the cleaner to have clocked in,
 * nothing past Accept opens before the job is accepted, and once accepted the
 * Accept step stays visible as a completed, non-interactive step.
 */
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { JOB_STAGE_LABELS, type JobStage } from "@/lib/cleaner/job-stage";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

const STAGES: JobStage[] = [1, 2, 3, 4, 5];

export function stageReachable(stage: JobStage, flags: { needsAcceptance: boolean; hasStarted: boolean }): boolean {
  if (stage === 1) return flags.needsAcceptance;
  if (flags.needsAcceptance) return false; // must accept first
  if (stage === 4 || stage === 5) return flags.hasStarted;
  return true; // 2 (Get there) + 3 (Set up) always reachable once accepted
}

export function stageComplete(stage: JobStage, flags: { needsAcceptance: boolean; hasStarted: boolean; locked: boolean }): boolean {
  if (stage === 1) return !flags.needsAcceptance;
  if (stage === 2 || stage === 3) return flags.hasStarted;
  if (stage === 4) return flags.locked;
  if (stage === 5) return flags.locked;
  return false;
}

export function StageNav({ api }: { api: WorkspaceApi }) {
  const { activeStage, setActiveStage, needsAcceptance, hasStarted, locked } = api;
  const flags = { needsAcceptance, hasStarted, locked };

  return (
    <nav aria-label="Job progress" className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max gap-1.5">
        {STAGES.map((stage) => {
          const active = stage === activeStage;
          const complete = stageComplete(stage, flags);
          // Accept, once done, is a record rather than a place to go back to.
          const reachable = stageReachable(stage, flags) && !(stage === 1 && complete);
          const label = JOB_STAGE_LABELS[stage];
          return (
            <li key={stage}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && setActiveStage(stage)}
                aria-current={active ? "step" : undefined}
                aria-label={`${label}${complete ? ", done" : active ? ", current step" : ""}`}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] font-[550] transition-colors focus-visible:outline focus-visible:outline-2",
                  active
                    ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-foreground))]"
                    : complete
                      ? "border-[hsl(var(--e-success)/0.4)] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-success))]"
                      : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))]",
                  !reachable && !complete && "opacity-50",
                )}
              >
                {complete && !active ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span aria-hidden className="tabular-nums">{stage}</span>}
                {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
