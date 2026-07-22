/**
 * QA arrival intelligence — how long will THIS cleaner take at THIS property,
 * and therefore when should the inspector arrive?
 *
 * The QA portal needs a live "EST finish" per stop so an inspector can plan a
 * route instead of guessing. A global average is useless here: cleaners differ
 * by 40%+ on the same property, and properties differ by 3x for the same
 * cleaner. So we blend, most-specific-first:
 *
 *   1. cleaner × property   (needs MIN_CONFIDENT_SAMPLES) — the real signal
 *   2. cleaner's personal pace ratio × the property's assigned hours
 *   3. the property's assigned/estimated hours              — cold start
 *
 * Everything here is PURE so it can be unit-tested without a database; the
 * caller supplies already-loaded stats. Predictions are advisory only — they
 * never auto-dispatch or auto-reorder anything.
 */

/** Below this sample count a cleaner×property mean is treated as noise. */
export const MIN_CONFIDENT_SAMPLES = 3;

export type PredictionSource =
  | "CLEANER_PROPERTY"
  | "CLEANER_PACE"
  | "PROPERTY_BASELINE"
  | "NONE";

export interface CleanerPropertySample {
  avgActualHours: number;
  p90ActualHours?: number | null;
  sampleCount: number;
}

export interface PredictionInput {
  /** Stat row for this exact cleaner+property pair, when one exists. */
  pair?: CleanerPropertySample | null;
  /**
   * This cleaner's overall pace vs plan across all properties: actual/estimated.
   * 1.0 = on plan, 1.2 = takes 20% longer than planned.
   */
  cleanerPaceRatio?: number | null;
  /** The property's assigned cleaning hours (or job estimatedHours). */
  propertyBaselineHours?: number | null;
}

export interface DurationPrediction {
  hours: number | null;
  source: PredictionSource;
  /** low | medium | high — drives how the UI hedges the wording. */
  confidence: "low" | "medium" | "high";
  /** Conservative estimate (p90 when available) for arrival planning. */
  conservativeHours: number | null;
}

function clampHours(value: number): number {
  // Guard against corrupt aggregates producing absurd ETAs.
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, 24);
}

/** Predict how long this cleaner will take at this property. */
export function predictDurationHours(input: PredictionInput): DurationPrediction {
  const pair = input.pair;
  if (pair && pair.sampleCount >= MIN_CONFIDENT_SAMPLES && pair.avgActualHours > 0) {
    const hours = clampHours(pair.avgActualHours);
    return {
      hours,
      source: "CLEANER_PROPERTY",
      confidence: pair.sampleCount >= MIN_CONFIDENT_SAMPLES * 2 ? "high" : "medium",
      conservativeHours: clampHours(pair.p90ActualHours ?? pair.avgActualHours),
    };
  }

  const baseline = input.propertyBaselineHours ?? null;
  if (baseline && baseline > 0) {
    const pace = input.cleanerPaceRatio;
    if (pace && pace > 0) {
      const hours = clampHours(baseline * pace);
      return { hours, source: "CLEANER_PACE", confidence: "medium", conservativeHours: hours };
    }
    const hours = clampHours(baseline);
    return { hours, source: "PROPERTY_BASELINE", confidence: "low", conservativeHours: hours };
  }

  return { hours: null, source: "NONE", confidence: "low", conservativeHours: null };
}

/** Predicted finish instant for an in-progress clean. */
export function predictFinishAt(
  clockedInAt: Date | string | null | undefined,
  prediction: DurationPrediction,
): Date | null {
  if (!clockedInAt || prediction.hours == null) return null;
  const start = clockedInAt instanceof Date ? clockedInAt : new Date(clockedInAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + prediction.hours * 60 * 60 * 1000);
}

/** True when the clean has already run past its prediction (running over). */
export function isRunningOver(
  clockedInAt: Date | string | null | undefined,
  prediction: DurationPrediction,
  now: Date = new Date(),
): boolean {
  const finish = predictFinishAt(clockedInAt, prediction);
  return finish != null && now.getTime() > finish.getTime();
}

// ── Suggested visit order ───────────────────────────────────────────────────

export interface QaStop {
  assignmentId: string;
  /** Predicted (or actual) time the clean is ready for inspection. */
  readyAt: Date | null;
  /** Minutes of travel to reach this stop from the previous one. */
  travelMinutesFromPrev?: number | null;
  /**
   * Hard deadline — typically the next guest check-in. Stops with a deadline
   * are prioritised so the inspection (and any rework) can still happen.
   */
  deadlineAt?: Date | null;
  /** Minutes the inspection itself is expected to take. */
  inspectionMinutes?: number | null;
}

export interface OrderedStop extends QaStop {
  /** Projected arrival if visited in the suggested position. */
  projectedArrivalAt: Date | null;
  /** True when we'd arrive before the clean is ready (dead wait). */
  waits: boolean;
  /** True when the projected finish breaches the stop's deadline. */
  breachesDeadline: boolean;
}

/**
 * Greedy earliest-feasible-arrival ordering: at each step pick the stop we can
 * actually start soonest (respecting readiness), breaking ties by the nearest
 * deadline. This is a SUGGESTION surfaced with a one-tap apply — never applied
 * automatically, because inspectors legitimately override for reasons the data
 * can't see (traffic, keys, a client call).
 */
export function suggestVisitOrder(stops: QaStop[], startAt: Date = new Date()): OrderedStop[] {
  const remaining = [...stops];
  const ordered: OrderedStop[] = [];
  let cursor = startAt;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestStart: number = Number.POSITIVE_INFINITY;
    let bestDeadline: number = Number.POSITIVE_INFINITY;

    remaining.forEach((stop, i) => {
      const travelMs = (stop.travelMinutesFromPrev ?? 0) * 60_000;
      const arrival = cursor.getTime() + travelMs;
      const ready = stop.readyAt ? stop.readyAt.getTime() : arrival;
      const start = Math.max(arrival, ready);
      const deadline = stop.deadlineAt ? stop.deadlineAt.getTime() : Number.POSITIVE_INFINITY;

      // Earliest start wins; a nearer deadline breaks ties.
      if (start < bestStart || (start === bestStart && deadline < bestDeadline)) {
        bestIndex = i;
        bestStart = start;
        bestDeadline = deadline;
      }
    });

    const [chosen] = remaining.splice(bestIndex, 1);
    const travelMs = (chosen.travelMinutesFromPrev ?? 0) * 60_000;
    const arrival = new Date(cursor.getTime() + travelMs);
    const startMs = bestStart;
    const inspectionMs = (chosen.inspectionMinutes ?? 30) * 60_000;
    const finishMs = startMs + inspectionMs;

    ordered.push({
      ...chosen,
      projectedArrivalAt: arrival,
      waits: chosen.readyAt != null && chosen.readyAt.getTime() > arrival.getTime(),
      breachesDeadline: chosen.deadlineAt != null && finishMs > chosen.deadlineAt.getTime(),
    });
    cursor = new Date(finishMs);
  }

  return ordered;
}
