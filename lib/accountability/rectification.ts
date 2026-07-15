/**
 * Rectification pay-band resolution (Phase 5a).
 *
 * When QA fixes a flagged item themselves (rectification), the QA is paid a small
 * amount scaled by how long the fix took, drawn from the configured
 * `settings.accountability.rectification.bands`. Anything past the last band /
 * over `managerReviewOverMinutes` earns nothing automatically and instead routes
 * to a manager for review.
 *
 * Pure module (no DB, no I/O) so it is unit-testable and reusable on both the
 * server route and any client preview of the band a given duration would earn.
 */
import type { AccountabilityRectificationSettings } from "@/lib/settings";

export interface RectificationBandResult {
  /** Dollar amount the QA earns for the fix (0 when manager review is required). */
  amount: number;
  /** True when the duration exceeds the manager-review threshold / last band. */
  requiresManagerReview: boolean;
}

/**
 * Resolve the rectification pay band for a fix that took `minutes`.
 *
 * Rules:
 *  - bands are sorted ascending by `maxMinutes`; the FIRST band whose
 *    `maxMinutes >= minutes` wins → { amount: band.amount, requiresManagerReview: false }
 *  - `minutes > managerReviewOverMinutes` (or beyond the last band) →
 *    { amount: 0, requiresManagerReview: true }
 */
export function resolveRectificationBand(
  minutes: number,
  rectification: AccountabilityRectificationSettings
): RectificationBandResult {
  const mins = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;

  const managerReviewOver = Number(rectification.managerReviewOverMinutes);
  if (Number.isFinite(managerReviewOver) && managerReviewOver > 0 && mins > managerReviewOver) {
    return { amount: 0, requiresManagerReview: true };
  }

  const bands = [...(rectification.bands ?? [])].sort((a, b) => a.maxMinutes - b.maxMinutes);
  for (const band of bands) {
    if (mins <= band.maxMinutes) {
      return { amount: Math.max(0, Number(band.amount) || 0), requiresManagerReview: false };
    }
  }

  // Beyond the last band — no automatic pay, needs a manager decision.
  return { amount: 0, requiresManagerReview: true };
}

/** Dedupe key for the QA rectification PAY / RECTIFICATION_DEDUCTION adjustments of an issue. */
export function buildRectificationSourceKey(issueId: string): string {
  return `rect:${issueId}`;
}

/** Dedupe key for the cross-cleaner REWORK_DEDUCTION adjustment of a rework job. */
export function buildReworkDeductionSourceKey(jobId: string): string {
  return `rework:${jobId}`;
}
