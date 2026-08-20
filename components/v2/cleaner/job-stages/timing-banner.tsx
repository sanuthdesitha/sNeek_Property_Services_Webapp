"use client";

/**
 * Early-check-in / late-checkout rule banners for the cleaner job workspace
 * (R6c). Renders one distinct chip per enabled rule from the form payload's
 * structured `timingRules`:
 *   - late checkout  → do NOT start before the time (guests still inside)
 *   - early check-in → must FINISH before the time (guests arrive early)
 *   - same-day check-in → a new guest arrives on the day of this clean
 * Renders nothing when no rule applies.
 */
import * as React from "react";
import { AlarmClock, LogIn, CalendarClock } from "lucide-react";
import { resolveArrivalNotice } from "@/lib/jobs/arrival-notice";

export interface JobTimingRulesPayload {
  earlyCheckin?: { time: string } | null;
  lateCheckout?: { time: string } | null;
}

/**
 * Same-day check-in comes off the JOB row (`Job.sameDayCheckin` /
 * `Job.sameDayCheckinTime`, set by the iCal sync), not off the structured
 * `timingRules` object the two rules above are built from — hence a separate
 * prop rather than another key on JobTimingRulesPayload.
 */
export interface SameDayCheckinPayload {
  /** True when a new guest checks in on the day of this clean. */
  active: boolean;
  /** Guest arrival time as stored: "HH:mm" 24h local. Rendered verbatim. */
  time?: string | null;
}

export function TimingRuleBanners({
  rules,
  sameDayCheckin,
  compact = false,
}: {
  rules: JobTimingRulesPayload | null | undefined;
  /**
   * Same-day check-in flag for this job. v1 surfaced it on job details and v2
   * dropped it, so a cleaner could not tell the clean was hard-stopped by an
   * incoming guest (CP-9). Optional so existing call sites stay valid.
   */
  sameDayCheckin?: SameDayCheckinPayload | null;
  /** Slimmer paddings for embedding inside a card. */
  compact?: boolean;
}) {
  const late = rules?.lateCheckout?.time;
  // Same-day and early check-in are the SAME event described twice. They
  // used to render as two banners carrying two different times.
  const arrival = resolveArrivalNotice({
    earlyCheckinTime: rules?.earlyCheckin?.time ?? null,
    sameDayActive: sameDayCheckin?.active === true,
    sameDayTime: sameDayCheckin?.time ?? null,
  });
  if (!late && !arrival) return null;

  const pad = compact ? "p-2.5" : "p-3";
  return (
    <div className="space-y-2">
      {arrival ? (
        <div className={`rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] ${pad}`}>
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
            {arrival.early ? (
              <AlarmClock className="h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
            ) : (
              <CalendarClock className="h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
            )}
            {arrival.early ? "Early check-in" : "Same-day check-in"}
            {arrival.time ? (
              <span className="tabular-nums font-[550]">— guest arrives {arrival.time}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {arrival.early
              ? "The next guests arrive early. This clean cannot run late"
              : "A new guest checks in today. This clean cannot run late"}
            {arrival.time ? ` — the property must be guest-ready by ${arrival.time}.` : "."}
          </p>
        </div>
      ) : null}
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

    </div>
  );
}
