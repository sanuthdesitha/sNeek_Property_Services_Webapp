/**
 * QA LIVE PROGRESS — pure helpers (Phase: early assignment / monitor mode).
 *
 * An admin can now hand an inspector a job BEFORE the cleaner has finished, so
 * the inspector can plan travel and watch the clean land. That means every QA
 * surface has to answer three questions about a job that is still running:
 *
 *   1. Is this gradable yet?            → `deriveReadiness`
 *   2. How far through is the clean?    → `checklistProgress`
 *   3. When will it be done?            → `computeTiming`
 *
 * Everything here is PURE (no DB, no clock reads except the injected `now`) so
 * the route can stay a thin adapter and the logic can be unit-tested. Every
 * input is optional — on a database that has not run the newest migrations the
 * caller legitimately knows nothing, and "unknown" must degrade to `null`
 * rather than a wrong number.
 */

import type { DurationPrediction } from "./prediction";

export type QaReadiness = "CLEANING" | "READY" | "REWORK_PENDING";

/** Job statuses at which a cleaner's work is finished enough to inspect. */
const GRADABLE_STATUSES = new Set(["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]);

/**
 * Is this job ready for the inspector to grade?
 *
 * A submission is the real signal — a cleaner who has filed the checklist is
 * done even if the job status hasn't caught up yet (the SUBMITTED transition
 * and the FormSubmission write are not a single transaction). Failing that we
 * fall back to the status. Rework jobs that are still being fixed get their own
 * label so the UI can say "waiting on the rework" instead of "cleaning".
 */
export function deriveReadiness(input: {
  status?: string | null;
  hasSubmission?: boolean | null;
  isRework?: boolean | null;
}): QaReadiness {
  const status = String(input.status ?? "").toUpperCase();
  if (input.hasSubmission) return "READY";
  if (GRADABLE_STATUSES.has(status)) return "READY";
  return input.isRework ? "REWORK_PENDING" : "CLEANING";
}

/**
 * Checklist completion for the cleaner's form.
 *
 * Returns `null` when we genuinely don't know (no template, no answers) — a
 * fabricated "0%" reads as "the cleaner has done nothing", which is worse than
 * showing nothing at all.
 */
export function checklistProgress(
  answered: number | null | undefined,
  total: number | null | undefined,
): { answered: number; total: number; percent: number } | null {
  if (!Number.isFinite(Number(total)) || Number(total) <= 0) return null;
  const totalCount = Math.floor(Number(total));
  const answeredCount = Math.max(0, Math.min(totalCount, Math.floor(Number(answered) || 0)));
  return {
    answered: answeredCount,
    total: totalCount,
    percent: Math.round((answeredCount / totalCount) * 100),
  };
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole minutes between two instants; null when the start is unknown. */
export function elapsedMinutes(
  startedAt: Date | string | null | undefined,
  now: Date = new Date(),
  endedAt?: Date | string | null,
): number | null {
  const start = toDate(startedAt);
  if (!start) return null;
  const end = toDate(endedAt) ?? now;
  const minutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
  return minutes < 0 ? 0 : minutes;
}

export interface QaProgressTiming {
  elapsedMinutes: number | null;
  estFinishAt: Date | null;
  /** Minutes still to run. 0 once the prediction has been passed. */
  minutesRemaining: number | null;
  runningOver: boolean;
}

/**
 * Blend the start stamp and the duration prediction into the numbers the HUD
 * shows. Any missing piece collapses that field to `null` — never to a guess.
 */
export function computeTiming(input: {
  startedAt?: Date | string | null;
  prediction?: Pick<DurationPrediction, "hours"> | null;
  now?: Date;
}): QaProgressTiming {
  const now = input.now ?? new Date();
  const start = toDate(input.startedAt);
  const elapsed = elapsedMinutes(start, now);
  const hours = input.prediction?.hours ?? null;

  if (!start || hours == null || !Number.isFinite(hours) || hours <= 0) {
    return { elapsedMinutes: elapsed, estFinishAt: null, minutesRemaining: null, runningOver: false };
  }

  const estFinishAt = new Date(start.getTime() + hours * 60 * 60 * 1000);
  const remaining = Math.round((estFinishAt.getTime() - now.getTime()) / 60_000);
  return {
    elapsedMinutes: elapsed,
    estFinishAt,
    minutesRemaining: remaining > 0 ? remaining : 0,
    runningOver: remaining < 0,
  };
}

/**
 * A cleaner's global pace: actual hours ÷ estimated hours across finished jobs.
 * `null` when there isn't enough signal — `predictDurationHours` then falls back
 * to the raw property baseline instead of scaling it by a meaningless ratio.
 */
export function cleanerPaceRatio(
  samples: Array<{ actualHours?: number | null; estimatedHours?: number | null }>,
  minSamples = 3,
): number | null {
  let actual = 0;
  let estimated = 0;
  let used = 0;
  for (const sample of samples ?? []) {
    const a = Number(sample?.actualHours);
    const e = Number(sample?.estimatedHours);
    if (!Number.isFinite(a) || !Number.isFinite(e) || a <= 0 || e <= 0) continue;
    actual += a;
    estimated += e;
    used += 1;
  }
  if (used < minSamples || estimated <= 0) return null;
  const ratio = actual / estimated;
  // Clamp: a corrupt aggregate must not triple an ETA.
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(Math.max(ratio, 0.5), 2);
}

/** Human hint explaining where an EST finish came from. */
export function predictionBasis(
  prediction: { source?: string | null } | null | undefined,
  sampleCount?: number | null,
): string | null {
  if (!prediction) return null;
  switch (prediction.source) {
    case "CLEANER_PROPERTY":
      return sampleCount && sampleCount > 0
        ? `based on ${sampleCount} previous clean${sampleCount === 1 ? "" : "s"} here`
        : "based on this cleaner's history here";
    case "CLEANER_PACE":
      return "estimated from this cleaner's usual pace";
    case "PROPERTY_BASELINE":
      return "estimated from the property's standard hours";
    default:
      return null;
  }
}
