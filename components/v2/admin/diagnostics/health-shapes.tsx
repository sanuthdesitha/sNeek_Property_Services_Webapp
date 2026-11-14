/**
 * The five System health states, each with its own shape and word so it
 * reads without colour (board "Diagnostics"): ● Working, ▲ Needs attention,
 * ▲ Not working (in the problem colour), □ Not set up, ◆ Cannot tell from
 * here (also "Key present" and "Not tested": known configuration, no
 * recorded use). Plain module (no hooks), safe from server pages.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import type { HealthState } from "@/lib/ops/system-health-types";

const SHAPE_COLOUR: Record<HealthState, string> = {
  working: "text-[hsl(var(--e-success))]",
  attention: "text-[hsl(var(--e-warning))]",
  failing: "text-[hsl(var(--e-danger))]",
  not_set_up: "text-[hsl(var(--e-muted-foreground))]",
  unknown: "text-[hsl(var(--e-text-secondary))]",
};

export function HealthShape({ state, className }: { state: HealthState; className?: string }) {
  const common = cn("inline-block h-3 w-3 shrink-0", SHAPE_COLOUR[state], className);
  switch (state) {
    case "working":
      return (
        <svg aria-hidden viewBox="0 0 12 12" className={common}>
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
      );
    case "attention":
    case "failing":
      return (
        <svg aria-hidden viewBox="0 0 12 12" className={common}>
          <path d="M6 1 L11 11 L1 11 Z" fill="currentColor" />
        </svg>
      );
    case "not_set_up":
      return (
        <svg aria-hidden viewBox="0 0 12 12" className={common}>
          <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    default:
      return (
        <svg aria-hidden viewBox="0 0 12 12" className={common}>
          <path d="M6 0.8 L11.2 6 L6 11.2 L0.8 6 Z" fill="currentColor" />
        </svg>
      );
  }
}

/** Shape and word together. The word is the accessible status. */
export function HealthStatus({ state, word, className }: { state: HealthState; word: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 font-semibold", className)}>
      <HealthShape state={state} />
      <span className="min-w-0 break-words">{word}</span>
    </span>
  );
}

/** Band tone for a flagged card or row; null keeps it plain. */
export function healthTone(state: HealthState): "attention" | "problem" | null {
  if (state === "attention") return "attention";
  if (state === "failing") return "problem";
  return null;
}

export const HEALTH_LEGEND: Array<{ state: HealthState; word: string }> = [
  { state: "working", word: "Working" },
  { state: "attention", word: "Needs attention" },
  { state: "failing", word: "Not working" },
  { state: "not_set_up", word: "Not set up" },
  { state: "unknown", word: "Cannot tell from here" },
];
