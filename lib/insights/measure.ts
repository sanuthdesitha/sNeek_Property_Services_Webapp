/**
 * Building blocks for every Insights figure.
 *
 * A per-record input is a `Known<T>`: either a value, or the reason it is
 * missing. Aggregating a list of them never turns a missing input into zero:
 * the record is excluded from that figure and counted under its reason.
 *
 * Thresholds (named, stated on screen):
 *   MIN_BASIS_SUMMARY  records a page-level figure needs before it is shown.
 *   MIN_BASIS_ROW      records a figure in a per-entity row needs.
 * Below the minimum the figure has no value ("Not enough data") and no change.
 *
 * Pure: safe in the browser and in tests.
 */
import {
  EXCLUSION_LABEL,
  type DeltaKind,
  type ExclusionCounts,
  type ExclusionReason,
  type Measure,
  type MeasureWithDelta,
} from "./types";

export const MIN_BASIS_SUMMARY = 5;
export const MIN_BASIS_ROW = 3;

export type Known<T> = { value: T; reason: null } | { value: null; reason: ExclusionReason };

export function known<T>(value: T): Known<T> {
  return { value, reason: null };
}

export function missing<T>(reason: ExclusionReason): Known<T> {
  return { value: null, reason };
}

export type Tally<T> = { values: T[]; excluded: ExclusionCounts; excludedCount: number };

/** Split known values from missing ones, counting each missing reason. */
export function tally<T>(items: ReadonlyArray<Known<T>>): Tally<T> {
  const values: T[] = [];
  const excluded: ExclusionCounts = {};
  let excludedCount = 0;
  for (const item of items) {
    if (item.reason === null) {
      values.push(item.value as T);
      continue;
    }
    excluded[item.reason] = (excluded[item.reason] ?? 0) + 1;
    excludedCount += 1;
  }
  return { values, excluded, excludedCount };
}

/** "no time log (20), no pay rate (8)", largest first. */
export function describeExclusions(excluded: ExclusionCounts): string | undefined {
  const entries = (Object.entries(excluded) as Array<[ExclusionReason, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return undefined;
  return entries.map(([reason, count]) => `${EXCLUSION_LABEL[reason]} (${count})`).join(", ");
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * A figure from a computed value and its basis. Below `minBasis` the value is
 * withheld; `reason` says why, or names the main exclusions when shown.
 */
export function buildMeasure(
  value: number | null,
  basisCount: number,
  excluded: ExclusionCounts,
  minBasis: number,
): Measure {
  const excludedCount = Object.values(excluded).reduce((sum, count) => sum + (count ?? 0), 0);
  const enough = basisCount >= minBasis && value !== null && Number.isFinite(value);
  const exclusions = describeExclusions(excluded);
  let reason: string | undefined = exclusions;
  if (!enough) {
    reason = basisCount === 0 ? "No records with the inputs this figure needs" : "Not enough data";
    if (exclusions) reason = `${reason}; excluded: ${exclusions}`;
  }
  return { value: enough ? value : null, basisCount, excludedCount, excluded, enough, reason };
}

/** A plain count (cleans, issues). A count of nothing is a true zero, not missing data. */
export function countMeasure(count: number): Measure {
  return { value: count, basisCount: count, excludedCount: 0, excluded: {}, enough: true };
}

/** Change against the previous period, or null when it cannot be stated honestly. */
export function computeDelta(current: Measure, previous: Measure | null, kind: DeltaKind): number | null {
  if (!previous || !current.enough || !previous.enough) return null;
  if (current.value === null || previous.value === null) return null;
  if (kind === "percent") {
    if (previous.value === 0) return null;
    return roundTo(((current.value - previous.value) / Math.abs(previous.value)) * 100, 1);
  }
  if (kind === "points") return roundTo(current.value - previous.value, 1);
  return current.value - previous.value;
}

export function withDelta(current: Measure, previous: Measure | null, kind: DeltaKind): MeasureWithDelta {
  return { ...current, previous, delta: computeDelta(current, previous, kind), deltaKind: kind };
}

/** Sum of known numbers (no rounding policy of its own: callers round money with roundCents). */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Merge exclusion counts from several tallies. */
export function mergeExcluded(...sets: ExclusionCounts[]): ExclusionCounts {
  const out: ExclusionCounts = {};
  for (const set of sets) {
    for (const [reason, count] of Object.entries(set) as Array<[ExclusionReason, number]>) {
      out[reason] = (out[reason] ?? 0) + count;
    }
  }
  return out;
}
