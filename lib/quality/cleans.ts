/**
 * Clean-level figures for the Quality hub: how many submitted cleans a period
 * holds, how many carry a review, and the average authoritative score.
 *
 * Basis (stated on screen): a clean is a job scheduled in the period (Sydney
 * day) that reached submission (Submitted, QA review, Completed or Invoiced).
 * Reviewed = it has at least one QA review of any kind. Score = the
 * authoritative review (QA > ADMIN > AUTO, then latest). A clean with several
 * cleaners counts once for the company and once for each cleaner, as the
 * accountability overview attributed it.
 *
 * Pure: the service loads the facts, these functions only count them.
 */
import { addDaysToKey, sydneyDateKey, weekMondayKey } from "@/lib/time/sydney-range";
import type { PeriodRange } from "./period";

export type CleanReview = { score: number; rating: string | null; managementReview: boolean; createdAt: Date };

export type CleanFact = {
  jobId: string;
  scheduledDate: Date;
  propertyId: string;
  cleanerIds: string[];
  /** Authoritative review, or null when the clean has none. */
  review: CleanReview | null;
};

export type CleanTotals = { cleans: number; reviewed: number; avgScore: number | null };
export type TrendPoint = { weekStart: string; avgScore: number | null; reviewed: number };

export const TREND_WEEKS = 8;

function inRange(date: Date, range: PeriodRange): boolean {
  return (range.start === null || date >= range.start) && date < range.end;
}

function average(sum: number, count: number): number | null {
  return count > 0 ? Math.round((sum / count) * 10) / 10 : null;
}

export function cleanTotals(cleans: readonly CleanFact[], range: PeriodRange): CleanTotals {
  let total = 0;
  let reviewed = 0;
  let sum = 0;
  for (const clean of cleans) {
    if (!inRange(clean.scheduledDate, range)) continue;
    total += 1;
    if (clean.review) {
      reviewed += 1;
      sum += clean.review.score;
    }
  }
  return { cleans: total, reviewed, avgScore: average(sum, reviewed) };
}

export function cleanTotalsByCleaner(cleans: readonly CleanFact[], range: PeriodRange): Map<string, CleanTotals> {
  const acc = new Map<string, { cleans: number; reviewed: number; sum: number }>();
  for (const clean of cleans) {
    if (!inRange(clean.scheduledDate, range)) continue;
    for (const cleanerId of clean.cleanerIds) {
      const row = acc.get(cleanerId) ?? { cleans: 0, reviewed: 0, sum: 0 };
      row.cleans += 1;
      if (clean.review) {
        row.reviewed += 1;
        row.sum += clean.review.score;
      }
      acc.set(cleanerId, row);
    }
  }
  const out = new Map<string, CleanTotals>();
  for (const [id, row] of Array.from(acc.entries())) {
    out.set(id, { cleans: row.cleans, reviewed: row.reviewed, avgScore: average(row.sum, row.reviewed) });
  }
  return out;
}

/**
 * Rating mix (restored from the accountability overview, parity audit
 * 2026-11-12): how a cleaner's reviewed cleans in the period were rated, using
 * that overview's rule. A review flagged for management review counts as
 * "Mgmt review" whatever its rating; otherwise its stored rating, when it is
 * one of the five. A review with no recognised rating is counted in `unrated`,
 * never folded into a band.
 */
export const RATING_KEYS = ["EXCELLENT", "PASS", "NEEDS_IMPROVEMENT", "FAILED", "MANAGEMENT_REVIEW"] as const;
export type RatingKey = (typeof RATING_KEYS)[number];
export type RatingMix = Record<RatingKey, number> & { unrated: number };

export const RATING_LABEL: Record<RatingKey, string> = {
  EXCELLENT: "Excellent",
  PASS: "Pass",
  NEEDS_IMPROVEMENT: "Needs work",
  FAILED: "Failed",
  MANAGEMENT_REVIEW: "Mgmt review",
};

export function emptyRatingMix(): RatingMix {
  return { EXCELLENT: 0, PASS: 0, NEEDS_IMPROVEMENT: 0, FAILED: 0, MANAGEMENT_REVIEW: 0, unrated: 0 };
}

export function effectiveRating(review: CleanReview): RatingKey | null {
  if (review.managementReview) return "MANAGEMENT_REVIEW";
  return (RATING_KEYS as readonly string[]).includes(review.rating ?? "") ? (review.rating as RatingKey) : null;
}

/** Whether an authoritative review sits in the management review queue (the old overview's rule). */
export function inManagementReview(review: CleanReview): boolean {
  return review.managementReview || review.rating === "MANAGEMENT_REVIEW";
}

export function ratingMixByCleaner(cleans: readonly CleanFact[], range: PeriodRange): Map<string, RatingMix> {
  const out = new Map<string, RatingMix>();
  for (const clean of cleans) {
    if (!clean.review || !inRange(clean.scheduledDate, range)) continue;
    const rating = effectiveRating(clean.review);
    for (const cleanerId of clean.cleanerIds) {
      const mix = out.get(cleanerId) ?? emptyRatingMix();
      if (rating) mix[rating] += 1;
      else mix.unrated += 1;
      out.set(cleanerId, mix);
    }
  }
  return out;
}

/** Reviewed cleans in the period whose authoritative review is in management review (each clean once). */
export function managementReviewCount(cleans: readonly CleanFact[], range: PeriodRange): number {
  return cleans.filter((clean) => clean.review && inRange(clean.scheduledDate, range) && inManagementReview(clean.review)).length;
}

/** Monday keys of the TREND_WEEKS Sydney weeks ending with the week of `toKey`. */
export function trendWeekKeys(toKey: string, weeks: number = TREND_WEEKS): string[] {
  const lastMonday = weekMondayKey(toKey);
  return Array.from({ length: weeks }, (_, index) => addDaysToKey(lastMonday, -7 * (weeks - 1 - index)));
}

/**
 * Weekly average authoritative score. A week with no reviewed clean has a null
 * score (drawn as a gap), never zero. `cleanerId` null = every clean.
 */
export function weeklyTrend(cleans: readonly CleanFact[], toKey: string, cleanerId: string | null): TrendPoint[] {
  const keys = trendWeekKeys(toKey);
  const buckets = new Map(keys.map((key) => [key, { sum: 0, reviewed: 0 }]));
  for (const clean of cleans) {
    if (!clean.review) continue;
    if (cleanerId && !clean.cleanerIds.includes(cleanerId)) continue;
    const bucket = buckets.get(weekMondayKey(sydneyDateKey(clean.scheduledDate)));
    if (!bucket) continue;
    bucket.sum += clean.review.score;
    bucket.reviewed += 1;
  }
  return keys.map((weekStart) => {
    const bucket = buckets.get(weekStart)!;
    return { weekStart, avgScore: average(bucket.sum, bucket.reviewed), reviewed: bucket.reviewed };
  });
}

/** First day of the trend window, for widening the clean query. */
export function trendStartKey(toKey: string): string {
  return trendWeekKeys(toKey)[0];
}
