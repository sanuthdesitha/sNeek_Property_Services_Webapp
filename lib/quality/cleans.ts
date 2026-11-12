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
