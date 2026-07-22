import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Nightly rebuild of the per-cleaner-per-property clean-duration model that
 * powers the QA portal's live "EST finish" and suggested visit order.
 *
 * Deliberate exclusions (they'd poison the mean):
 *  - rework jobs (short, corrective, not a normal clean)
 *  - jobs with no recorded actual hours
 *  - outliers beyond 3σ of the pair's own distribution (a cleaner who forgot to
 *    clock out shouldn't turn a 3h property into an 11h one)
 *
 * The table is a cache: it can be dropped and rebuilt from Job history at any
 * time, and every consumer degrades gracefully when a row is missing.
 */

/** Jobs older than this stop reflecting how the cleaner works today. */
const LOOKBACK_DAYS = 180;
/**
 * Outlier rejection uses the MEDIAN + MAD, not mean/σ. With the small samples we
 * have per cleaner+property, a single forgot-to-clock-out ghost (say 20h among
 * five 3h cleans) inflates σ so much that it falls inside 3σ and shields itself
 * — the classic masking problem. The median/MAD pair is resistant to that.
 *
 * A value is only discarded when it is BOTH statistically extreme (beyond
 * MAD_SIGMA robust deviations) AND more than MIN_RELATIVE_DEVIATION away from
 * the median — so a legitimately slow clean isn't thrown away just because the
 * cleaner is usually very consistent.
 */
const MAD_SIGMA = 3;
/** 1.4826 · MAD ≈ σ for normally distributed data. */
const MAD_TO_SIGMA = 1.4826;
const MIN_RELATIVE_DEVIATION = 0.5;

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Reduce raw samples to the stored aggregate. Exported pure so it can be tested
 * without a database.
 */
export function summarizeSamples(hours: number[]): {
  avgActualHours: number;
  p90ActualHours: number;
  sampleCount: number;
} | null {
  const clean = hours.filter((h) => Number.isFinite(h) && h > 0 && h <= 24);
  if (clean.length === 0) return null;

  let kept = clean;
  if (clean.length >= 3) {
    const med = median(clean);
    const mad = median(clean.map((h) => Math.abs(h - med)));
    // Must be beyond BOTH bounds to be discarded (see the constants above).
    const robustBound = MAD_SIGMA * MAD_TO_SIGMA * mad;
    const relativeBound = MIN_RELATIVE_DEVIATION * med;
    const threshold = Math.max(robustBound, relativeBound);
    if (threshold > 0) {
      const filtered = clean.filter((h) => Math.abs(h - med) <= threshold);
      if (filtered.length > 0) kept = filtered;
    }
  }

  const sorted = [...kept].sort((a, b) => a - b);
  return {
    avgActualHours: Number(mean(kept).toFixed(3)),
    p90ActualHours: Number(percentile(sorted, 0.9).toFixed(3)),
    sampleCount: kept.length,
  };
}

/** Rebuild the whole table. Safe to run repeatedly. */
export async function rebuildCleanerPropertyStats(now: Date = new Date()): Promise<{
  pairs: number;
  samples: number;
}> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const jobs = await db.job.findMany({
    where: {
      isRework: false,
      actualHours: { not: null, gt: 0 },
      scheduledDate: { gte: since },
      status: { in: ["COMPLETED", "INVOICED", "QA_REVIEW", "SUBMITTED"] },
    },
    select: {
      propertyId: true,
      actualHours: true,
      scheduledDate: true,
      assignments: { where: { removedAt: null }, select: { userId: true } },
    },
  });

  // key = `${cleanerId}::${propertyId}`
  const buckets = new Map<string, { hours: number[]; lastJobAt: Date | null }>();
  for (const job of jobs) {
    if (!job.propertyId || job.actualHours == null) continue;
    // A shared clean splits the wall-clock across the team, so each cleaner's
    // contribution — not the whole job — is the sample.
    const cleaners = job.assignments.map((a) => a.userId);
    if (cleaners.length === 0) continue;
    const perCleanerHours = Number(job.actualHours) / cleaners.length;

    for (const cleanerId of cleaners) {
      const key = `${cleanerId}::${job.propertyId}`;
      const bucket = buckets.get(key) ?? { hours: [], lastJobAt: null };
      bucket.hours.push(perCleanerHours);
      if (!bucket.lastJobAt || (job.scheduledDate && job.scheduledDate > bucket.lastJobAt)) {
        bucket.lastJobAt = job.scheduledDate ?? bucket.lastJobAt;
      }
      buckets.set(key, bucket);
    }
  }

  let pairs = 0;
  let samples = 0;
  for (const [key, bucket] of Array.from(buckets.entries())) {
    const summary = summarizeSamples(bucket.hours);
    if (!summary) continue;
    const [cleanerId, propertyId] = key.split("::");
    try {
      await db.cleanerPropertyStat.upsert({
        where: { cleanerId_propertyId: { cleanerId, propertyId } },
        create: {
          cleanerId,
          propertyId,
          avgActualHours: summary.avgActualHours,
          p90ActualHours: summary.p90ActualHours,
          sampleCount: summary.sampleCount,
          lastJobAt: bucket.lastJobAt,
        },
        update: {
          avgActualHours: summary.avgActualHours,
          p90ActualHours: summary.p90ActualHours,
          sampleCount: summary.sampleCount,
          lastJobAt: bucket.lastJobAt,
        },
      });
      pairs += 1;
      samples += summary.sampleCount;
    } catch (err) {
      // A single bad pair (e.g. a deleted cleaner) must not abort the rebuild.
      logger.error({ err, cleanerId, propertyId }, "[cleaner-property-stats] upsert failed");
    }
  }

  return { pairs, samples };
}
