/**
 * ESTATE stage bar: a read-only row of numbered stages (the concept's `.step`
 * strip). It shows state; it never offers an action. Each stage says its state
 * in words for assistive technology, so colour never carries it alone.
 *
 *   done     — happened (recorded)
 *   current  — the record is at this stage now
 *   pending  — started but not confirmed (e.g. a Xero push awaiting its id)
 *   passed   — behind the current stage, but not recorded (optional steps)
 *   skipped  — did not happen and no longer will
 *   todo     — not yet
 *
 * A terminal state (e.g. void) replaces the stages with one plain bar.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type EStageState = "done" | "current" | "pending" | "passed" | "skipped" | "todo";

export type EStage = {
  key: string;
  label: string;
  state: EStageState;
  /** Short qualifier shown under the label, e.g. "Part paid" or "Pending". */
  note?: string | null;
  /** Drawn without a number (an alternative ending such as "or Declined"). */
  unnumbered?: boolean;
};

export type EStageBarProps = {
  /** Accessible name, e.g. "Invoice stages". */
  label: string;
  stages: EStage[];
  /** Replaces the stages, e.g. { title: "Void", description: "Cancelled; …" }. */
  terminal?: { title: string; description: string } | null;
  className?: string;
};

const STATE_WORDS: Record<EStageState, string> = {
  done: "done",
  current: "current stage",
  pending: "pending",
  passed: "passed, not recorded",
  skipped: "skipped",
  todo: "not yet",
};

const STATE_CLASS: Record<EStageState, string> = {
  done: "bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]",
  current: "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]",
  pending: "bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-warning))]",
  passed: "bg-[hsl(var(--e-primary-soft)/0.55)] text-[hsl(var(--e-primary))]",
  skipped: "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-text-faint))] line-through decoration-1",
  todo: "bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-muted-foreground))]",
};

export function EStageBar({ label, stages, terminal, className }: EStageBarProps) {
  if (terminal) {
    return (
      <div
        role="group"
        aria-label={label}
        className={cn(
          "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.75rem]",
          className,
        )}
      >
        <span className="font-[600] text-[hsl(var(--e-foreground))]">{terminal.title}</span>
        <span className="text-[hsl(var(--e-muted-foreground))]">{terminal.description}</span>
      </div>
    );
  }
  return (
    <ol aria-label={label} className={cn("flex overflow-hidden rounded-[var(--e-radius)]", className)}>
      {stages.map((stage, index) => (
        <li
          key={stage.key}
          aria-current={stage.state === "current" ? "step" : undefined}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center justify-center px-1 py-2 text-center text-[0.75rem] font-[600] leading-tight",
            STATE_CLASS[stage.state],
          )}
        >
          <span className="break-words">
            {stage.unnumbered ? stage.label : `${index + 1} ${stage.label}`}
          </span>
          {stage.note ? <span className="mt-0.5 text-[0.6875rem] font-[500] no-underline">{stage.note}</span> : null}
          <span className="sr-only">, {STATE_WORDS[stage.state]}</span>
        </li>
      ))}
    </ol>
  );
}
