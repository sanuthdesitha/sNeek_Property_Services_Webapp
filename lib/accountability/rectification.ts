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

/**
 * WHO gets paid the QA rectification money.
 *
 * This resolution used to live inline in the admin PATCH route as:
 *
 *   const resolvedRectifiedById =
 *     body.rectifiedById ??
 *     (body.status === FIXED_BY_QA ? session.user.id : issue.rectifiedById ?? null);
 *   …
 *   cleanerId: resolvedRectifiedById ?? session.user.id,
 *
 * which had two defects, both of which paid the WRONG person:
 *
 *   1. On the FIXED_BY_QA branch (the only branch that creates money) it
 *      ignored `issue.rectifiedById` entirely and used the SESSION user. The
 *      admin Quality workspace never sends `rectifiedById` at all, so an
 *      ADMIN/OPS recording the fix on the inspector's behalf credited
 *      THEMSELVES, not the QA inspector who did the work.
 *   2. The final `?? session.user.id` repeated the same mistake as a fallback.
 *
 * The rule below never falls back to a non-QA session user. Precedence:
 *
 *   1. an explicit payee supplied by the caller (admin picked someone);
 *   2. the rectifier already recorded on the issue;
 *   3. the session user, but ONLY when they are the QA inspector doing the fix
 *      themselves (a QA_INSPECTOR session);
 *   4. the QA who raised the issue — the inspector on the ground.
 *
 * Returns null when none of those resolve, in which case the caller must NOT
 * create pay (better no money than money to the wrong person).
 */
export interface RectificationPayeeInput {
  /** `body.rectifiedById` — an explicit admin choice, wins outright. */
  explicitRectifiedById?: string | null;
  /** `QaIssue.rectifiedById` — who was previously recorded as the rectifier. */
  issueRectifiedById?: string | null;
  /** `QaIssue.raisedById` — the QA inspector who filed the issue. */
  issueRaisedById?: string | null;
  /** The signed-in user performing this action. */
  sessionUserId: string;
  /** Their role. Only a QA_INSPECTOR self-credits by default. */
  sessionRole: string;
}

export interface RectificationPayeeResult {
  payeeUserId: string | null;
  /** Which precedence rule produced the payee — audited + surfaced in the UI. */
  source: "EXPLICIT" | "ISSUE_RECTIFIER" | "SESSION_QA" | "ISSUE_RAISER" | "UNRESOLVED";
}

export function resolveRectificationPayee(
  input: RectificationPayeeInput
): RectificationPayeeResult {
  const explicit = input.explicitRectifiedById?.trim();
  if (explicit) return { payeeUserId: explicit, source: "EXPLICIT" };

  const recorded = input.issueRectifiedById?.trim();
  if (recorded) return { payeeUserId: recorded, source: "ISSUE_RECTIFIER" };

  if (input.sessionRole === "QA_INSPECTOR") {
    return { payeeUserId: input.sessionUserId, source: "SESSION_QA" };
  }

  const raiser = input.issueRaisedById?.trim();
  if (raiser) return { payeeUserId: raiser, source: "ISSUE_RAISER" };

  return { payeeUserId: null, source: "UNRESOLVED" };
}

/** Dedupe key for the QA rectification PAY / RECTIFICATION_DEDUCTION adjustments of an issue. */
export function buildRectificationSourceKey(issueId: string): string {
  return `rect:${issueId}`;
}

/** Dedupe key for the cross-cleaner REWORK_DEDUCTION adjustment of a rework job. */
export function buildReworkDeductionSourceKey(jobId: string): string {
  return `rework:${jobId}`;
}
