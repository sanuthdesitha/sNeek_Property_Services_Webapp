/**
 * Aggregate a set of cleans into the common Insights measures.
 *
 * Every rate and total is computed over the records that carry its inputs;
 * the rest are excluded and counted by reason (see ./measure). Definitions:
 *  - Revenue: sum of scheduled charges over cleans with a charge.
 *  - Cleaner cost: sum of recorded pay over cleans with a cost.
 *  - Margin: (revenue − cleaner cost) ÷ revenue, ONLY over cleans where both
 *    are known, as a percentage. No margin when that revenue is not positive.
 *  - Planned / actual hours and their ratio: over cleans with both.
 *  - Overrun: logged time exceeds planned by more than OVERRUN_TOLERANCE_MINUTES.
 *  - On time: share of cleans with a start time and a clock-in that started on time.
 *  - QA score: the Quality hub's clean totals (lib/quality/cleans), so both
 *    pages give the same average for the same cleans.
 *  - Rework rate: rework jobs ÷ cleans in the period (rework jobs are cleans
 *    too). For a cleaner, the rework jobs that redo one of their cleans.
 *
 * Pure.
 */
import { roundCents } from "@/lib/finance/job-money";
import { cleanTotals, type CleanFact, type CleanTotals } from "@/lib/quality/cleans";
import type { PeriodRange } from "@/lib/quality/period";
import type { JobFact } from "./job-facts";
import { buildMeasure, roundTo, sum, tally, type Known } from "./measure";
import type { EntityFigures, ExclusionCounts, ExclusionReason, HoursFigures, Measure, MoneyFigures } from "./types";

export const OVERRUN_TOLERANCE_MINUTES = 5;

export type HoursItem = { plannedMinutes: Known<number>; actualMinutes: Known<number> };
type HoursPair = { planned: number; actual: number };

function bump(excluded: ExclusionCounts, reason: ExclusionReason): void {
  excluded[reason] = (excluded[reason] ?? 0) + 1;
}

/** Pairs where both inputs are known; the first missing reason counts the rest. */
function pairs<A, B>(items: ReadonlyArray<{ a: Known<A>; b: Known<B> }>): { both: Array<{ a: A; b: B }>; excluded: ExclusionCounts } {
  const both: Array<{ a: A; b: B }> = [];
  const excluded: ExclusionCounts = {};
  for (const item of items) {
    if (item.a.reason !== null) bump(excluded, item.a.reason);
    else if (item.b.reason !== null) bump(excluded, item.b.reason);
    else both.push({ a: item.a.value as A, b: item.b.value as B });
  }
  return { both, excluded };
}

export function hoursFigures(items: readonly HoursItem[], minBasis: number): HoursFigures {
  const { both, excluded } = pairs(items.map((item) => ({ a: item.plannedMinutes, b: item.actualMinutes })));
  const list: HoursPair[] = both.map((pair) => ({ planned: pair.a, actual: pair.b }));
  const planned = sum(list.map((pair) => pair.planned));
  const actual = sum(list.map((pair) => pair.actual));
  const ratio = planned > 0 ? roundTo((actual / planned) * 100, 1) : null;
  const overMinutes = list.map((pair) => pair.actual - pair.planned);
  const enough = list.length >= minBasis;
  return {
    plannedHours: buildMeasure(roundTo(planned / 60, 1), list.length, excluded, minBasis),
    actualHours: buildMeasure(roundTo(actual / 60, 1), list.length, excluded, minBasis),
    ratio: buildMeasure(ratio, list.length, excluded, minBasis),
    overruns: overMinutes.filter((minutes) => minutes > OVERRUN_TOLERANCE_MINUTES).length,
    averageOverMinutes: enough && list.length > 0 ? Math.round(sum(overMinutes) / list.length) : null,
  };
}

export function moneyFigures(facts: readonly JobFact[], minBasis: number): MoneyFigures {
  const revenue = tally(facts.map((fact) => fact.charge));
  const cost = tally(facts.map((fact) => fact.cost));
  const { both, excluded } = pairs(facts.map((fact) => ({ a: fact.charge, b: fact.cost })));
  const bothRevenue = sum(both.map((pair) => pair.a));
  const bothCost = sum(both.map((pair) => pair.b));
  const margin = bothRevenue > 0 ? roundTo(((bothRevenue - bothCost) / bothRevenue) * 100, 1) : null;
  return {
    revenue: buildMeasure(roundCents(sum(revenue.values)), revenue.values.length, revenue.excluded, minBasis),
    cleanerCost: buildMeasure(roundCents(sum(cost.values)), cost.values.length, cost.excluded, minBasis),
    margin: buildMeasure(margin, both.length, excluded, minBasis),
  };
}

export function onTimeMeasure(facts: readonly JobFact[], minBasis: number): Measure {
  const result = tally(facts.map((fact) => fact.onTime));
  const onTime = result.values.filter(Boolean).length;
  const pct = result.values.length > 0 ? roundTo((onTime / result.values.length) * 100, 1) : null;
  return buildMeasure(pct, result.values.length, result.excluded, minBasis);
}

/** The Quality hub's clean shape, so its pure counters can be reused unchanged. */
export function toCleanFacts(facts: readonly JobFact[]): CleanFact[] {
  return facts.map((fact) => ({
    jobId: fact.jobId,
    scheduledDate: fact.scheduledAt,
    propertyId: fact.propertyId,
    cleanerIds: fact.cleanerIds,
    review: fact.review,
  }));
}

/** An unbounded range: the facts handed to the Quality counters are already one period. */
export const ALL_TIME: PeriodRange = { fromKey: null, toKey: "9999-12-31", start: null, end: new Date(8.64e15), days: null };

/** Quality hub clean totals over every fact. */
export function qaTotals(facts: readonly JobFact[]): CleanTotals {
  return cleanTotals(toCleanFacts(facts), ALL_TIME);
}

export function qaMeasure(totals: CleanTotals, minBasis: number): Measure {
  return buildMeasure(totals.avgScore, totals.reviewed, {}, minBasis);
}

export function reworkMeasure(reworkJobs: number, cleans: number, minBasis: number): Measure {
  const rate = cleans > 0 ? roundTo((reworkJobs / cleans) * 100, 1) : null;
  return buildMeasure(rate, cleans, {}, minBasis);
}

export type SummariseOptions = {
  minBasis: number;
  /** Include revenue, cost and margin (finance feature). */
  money: boolean;
  /** QaIssue count for this entity in the period (counted in the database). */
  issues: number;
  /** Override for a cleaner: rework jobs redoing their cleans. Default: rework facts in the set. */
  reworkJobs?: number;
  /** Override for a cleaner: their own shares of planned and logged time. */
  hoursItems?: readonly HoursItem[];
  /** Override for a cleaner: Quality hub per-cleaner totals. */
  qa?: CleanTotals;
};

export function summarise(facts: readonly JobFact[], options: SummariseOptions): EntityFigures {
  const cleans = facts.length;
  const reworkJobs = options.reworkJobs ?? facts.filter((fact) => fact.isRework).length;
  const qa = options.qa ?? qaTotals(facts);
  const figures: EntityFigures = {
    cleans,
    hours: hoursFigures(options.hoursItems ?? facts, options.minBasis),
    onTime: onTimeMeasure(facts, options.minBasis),
    qaScore: qaMeasure(qa, options.minBasis),
    reviewed: qa.reviewed,
    issues: options.issues,
    reworkJobs,
    reworkRate: reworkMeasure(reworkJobs, cleans, options.minBasis),
  };
  if (options.money) figures.money = moneyFigures(facts, options.minBasis);
  return figures;
}

