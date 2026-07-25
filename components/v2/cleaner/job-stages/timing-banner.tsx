"use client";

/**
 * Early-check-in / late-checkout rule banners for the cleaner job workspace
 * (R6c). Renders one distinct chip per enabled rule from the form payload's
 * structured `timingRules`:
 *   - late checkout  → do NOT start before the time (guests still inside)
 *   - early check-in → must FINISH before the time (guests arrive early)
 * Renders nothing when no rule applies.
 */
import * as React from "react";
import { AlarmClock, LogIn } from "lucide-react";

export interface JobTimingRulesPayload {
  earlyCheckin?: { time: string } | null;
  lateCheckout?: { time: string } | null;
}

export function TimingRuleBanners({
  rules,
  compact = false,
}: {
  rules: JobTimingRulesPayload | null | undefined;
  /** Slimmer paddings for embedding inside a card. */
  compact?: boolean;
}) {
  const late = rules?.lateCheckout?.time;
  const early = rules?.earlyCheckin?.time;
  if (!late && !early) return null;

  const pad = compact ? "p-2.5" : "p-3";
  return (
    <div className="space-y-2">
      {late ? (
        <div className={`rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] ${pad}`}>
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
            <LogIn className="h-4 w-4 shrink-0 text-[hsl(var(--e-danger))]" />
            Late checkout — start after {late}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            Guests are checking out late. Do not enter or start before {late}.
          </p>
        </div>
      ) : null}
      {early ? (
        <div className={`rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] ${pad}`}>
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
            <AlarmClock className="h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
            Early check-in — finish before {early}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            The next guests arrive early. The property must be guest-ready by {early}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
