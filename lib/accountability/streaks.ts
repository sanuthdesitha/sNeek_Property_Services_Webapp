/**
 * Accountability streaks & quality bonuses (Phase 6).
 *
 * Two proposal engines, both consent-gated: they only ever create PENDING
 * `CleanerPayAdjustment` rows — a manager must approve before payroll picks them
 * up. Nothing here auto-approves.
 *
 *  1. STREAK bonuses — a cleaner who strings together N consecutive high-quality
 *     cleans earns a fixed bonus ($20 at 5, +$40 at 10). "High quality" =
 *     authoritative QA score ≥ streakMinScore AND no critical issue / client
 *     complaint / missing evidence on the clean.
 *  2. MONTHLY ranking — the top two cleaners (by average authoritative score,
 *     with a minimum volume + quality gate) earn a monthly recognition bonus.
 *
 * The pure functions (`computeStreak`, `evaluateStreakBonuses`,
 * `evaluateMonthlyRanking`) hold all the logic and are unit-tested in isolation.
 * `runAccountabilityNightly` is the thin DB shell the nightly worker calls.
 *
 * Dedupe: every auto-proposal carries a deterministic `sourceKey`. Streak keys
 * are anchored to the JOB that COMPLETED the streak (`streak5:<cleaner>:<job>`),
 * so a nightly re-run over the same data produces the same key and is skipped.
 * Monthly keys are anchored to the month (`monthly:2026-07:1`).
 */
import {
  PayAdjustmentScope,
  PayAdjustmentStatus,
  PayAdjustmentType,
  QaIssueSeverity,
  Role,
  JobStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import type { AccountabilityBonusSettings } from "@/lib/settings";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";
import { resolveAppUrl } from "@/lib/app-url";

const KIND_PRIORITY: Record<string, number> = { QA: 3, ADMIN: 2, AUTO: 1 };

// ── Pure: streak counting ────────────────────────────────────────────────────

/** One completed clean, reduced to the four facts a streak cares about. */
export interface CleanRecord {
  score: number | null;
  hadCritical: boolean;
  hadComplaint: boolean;
  hadMissingEvidence: boolean;
}

function qualifies(clean: CleanRecord, minScore: number): boolean {
  return (
    clean.score != null &&
    clean.score >= minScore &&
    !clean.hadCritical &&
    !clean.hadComplaint &&
    !clean.hadMissingEvidence
  );
}

/**
 * Current streak = the run of consecutive qualifying cleans counting back from
 * the most recent. `cleans` MUST be ordered newest-first. The first
 * non-qualifying clean stops the count.
 */
export function computeStreak(cleans: CleanRecord[], minScore: number): number {
  let streak = 0;
  for (const clean of cleans) {
    if (!qualifies(clean, minScore)) break;
    streak++;
  }
  return streak;
}

// ── Pure: streak bonus proposals ─────────────────────────────────────────────

export type StreakSource = "STREAK_5" | "STREAK_10";

export interface StreakBonusProposal {
  source: StreakSource;
  sourceKey: string;
  amount: number;
}

/**
 * Propose streak bonuses for the current streak length. Fires on EXACT
 * thresholds (== streakLength, == extendedStreakLength) so a re-run at the same
 * streak doesn't keep re-proposing, and a longer streak (11, 12…) proposes
 * nothing new. The extended bonus is additive — at streak 10 the cleaner keeps
 * the earlier $20 (awarded when they hit 5, anchored to that earlier job) and
 * gains the +$40 here. Keys already in `alreadyAwardedKeys` are skipped.
 */
export function evaluateStreakBonuses(
  streak: number,
  alreadyAwardedKeys: Set<string>,
  cleanerId: string,
  anchorJobId: string,
  bonuses: AccountabilityBonusSettings,
): StreakBonusProposal[] {
  const proposals: StreakBonusProposal[] = [];

  if (streak === bonuses.streakLength) {
    const sourceKey = `streak5:${cleanerId}:${anchorJobId}`;
    if (!alreadyAwardedKeys.has(sourceKey)) {
      proposals.push({ source: "STREAK_5", sourceKey, amount: bonuses.streakAmount });
    }
  }

  if (streak === bonuses.extendedStreakLength) {
    const sourceKey = `streak10:${cleanerId}:${anchorJobId}`;
    if (!alreadyAwardedKeys.has(sourceKey)) {
      proposals.push({ source: "STREAK_10", sourceKey, amount: bonuses.extendedStreakAmount });
    }
  }

  return proposals;
}

// ── Pure: monthly ranking proposals ──────────────────────────────────────────

export interface MonthlyRankingRow {
  cleanerId: string;
  cleans: number;
  avgScore: number;
}

export type MonthlySource = "MONTHLY_RANK_1" | "MONTHLY_RANK_2";

export interface MonthlyRankingProposal {
  cleanerId: string;
  source: MonthlySource;
  sourceKey: string;
  amount: number;
}

/**
 * Rank eligible cleaners for a month and propose the #1 / #2 bonuses. Eligible =
 * cleans ≥ monthlyMinCleans AND avgScore ≥ monthlyMinAvgScore. Ranked by
 * avgScore desc; ties broken by more cleans. `month` is a "YYYY-MM" string used
 * verbatim in the sourceKey.
 */
export function evaluateMonthlyRanking(
  rows: MonthlyRankingRow[],
  month: string,
  bonuses: AccountabilityBonusSettings,
): MonthlyRankingProposal[] {
  const eligible = rows
    .filter((r) => r.cleans >= bonuses.monthlyMinCleans && r.avgScore >= bonuses.monthlyMinAvgScore)
    .sort((a, b) => (b.avgScore !== a.avgScore ? b.avgScore - a.avgScore : b.cleans - a.cleans));

  const proposals: MonthlyRankingProposal[] = [];
  if (eligible[0]) {
    proposals.push({
      cleanerId: eligible[0].cleanerId,
      source: "MONTHLY_RANK_1",
      sourceKey: `monthly:${month}:1`,
      amount: bonuses.monthlyFirstAmount,
    });
  }
  if (eligible[1]) {
    proposals.push({
      cleanerId: eligible[1].cleanerId,
      source: "MONTHLY_RANK_2",
      sourceKey: `monthly:${month}:2`,
      amount: bonuses.monthlySecondAmount,
    });
  }
  return proposals;
}

// ── DB shell ─────────────────────────────────────────────────────────────────

type QaReviewLite = { score: number; kind: string; createdAt: Date; managementReview: boolean };

/** Authoritative review for a job: highest kind priority, then most recent. */
function pickAuthoritative(reviews: QaReviewLite[]): QaReviewLite | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((best, current) => {
    const bestPriority = KIND_PRIORITY[best.kind] ?? 1;
    const currentPriority = KIND_PRIORITY[current.kind] ?? 1;
    if (currentPriority > bestPriority) return current;
    if (currentPriority === bestPriority && current.createdAt > best.createdAt) return current;
    return best;
  });
}

/** Month arithmetic on a "YYYY-MM" string (UTC). */
function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split("-").map((n) => parseInt(n, 10));
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

/** "2026-07" → "July 2026" for human-facing titles. */
function monthLabel(month: string): string {
  const { start } = monthRange(month);
  return start.toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Previous calendar month (Sydney) as "YYYY-MM", relative to `now`. */
function previousMonthKey(now: Date): string {
  // Sydney-local year/month, then step back one month.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parseInt(parts.find((p) => p.type === "year")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "month")!.value, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 = previous month index
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Is `now` the 1st of the month in Sydney? */
function isFirstOfMonthSydney(now: Date): boolean {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
  }).format(now);
  return day === "01";
}

/**
 * Nightly accountability pass. For every active cleaner:
 *  - loads their most recent COMPLETED jobs that carry a QA review,
 *  - derives per-clean qualify facts (authoritative score, critical issue,
 *    client complaint; missing-evidence is a documented placeholder — see below),
 *  - computes the current streak and proposes streak bonuses (deduped),
 *  - on the 1st (or when `month` is passed) ranks the PREVIOUS month and
 *    proposes the top-two monthly bonuses.
 *
 * `hadMissingEvidence` is intentionally a hard-coded `false`: missing-evidence is
 * not modelled as a QaIssue and rawScore deductions aren't cheaply attributable
 * to it, so we keep the strict gates to score/critical/complaint rather than
 * guess. Documented here so a future signal can slot in without surprise.
 *
 * All proposals are PENDING — a manager approves before payroll. Returns a
 * summary for logging.
 */
export async function runAccountabilityNightly(
  options: { now?: Date; month?: string } = {},
): Promise<{ streakProposals: number; monthlyProposals: number }> {
  const now = options.now ?? new Date();
  const settings = await getAppSettings();
  const bonuses = settings.accountability.bonuses;

  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true },
  });

  // Load enough completed+reviewed jobs to confirm the exact streak length (need
  // one beyond extendedStreakLength to know a streak stopped at 10 vs continued).
  const lookback = Math.max(bonuses.extendedStreakLength, bonuses.streakLength) + 5;

  let streakProposals = 0;
  const newlyProposedCleaners = new Set<string>();

  for (const cleaner of cleaners) {
    const jobs = await db.job.findMany({
      where: {
        status: JobStatus.COMPLETED,
        assignments: { some: { userId: cleaner.id } },
        qaReviews: { some: {} },
      },
      orderBy: { completedAt: "desc" },
      take: lookback,
      select: {
        id: true,
        propertyId: true,
        qaReviews: { select: { score: true, kind: true, createdAt: true, managementReview: true } },
        qaIssues: { select: { severity: true } },
        feedback: { select: { rating: true } },
        satisfactionRating: { select: { score: true } },
      },
    });
    if (jobs.length === 0) continue;

    const records: CleanRecord[] = jobs.map((job) => {
      const review = pickAuthoritative(job.qaReviews as QaReviewLite[]);
      const hadCritical =
        (review?.managementReview ?? false) ||
        job.qaIssues.some((i) => i.severity === QaIssueSeverity.CRITICAL);
      const hadComplaint =
        (job.feedback?.rating != null && job.feedback.rating <= 2) ||
        (job.satisfactionRating?.score != null && job.satisfactionRating.score <= 2);
      return {
        score: review?.score ?? null,
        hadCritical,
        hadComplaint,
        hadMissingEvidence: false, // documented placeholder — see fn doc
      };
    });

    const streak = computeStreak(records, bonuses.streakMinScore);
    const anchorJob = jobs[0];

    // Dedupe: only the two candidate keys matter.
    const candidateKeys = [
      `streak5:${cleaner.id}:${anchorJob.id}`,
      `streak10:${cleaner.id}:${anchorJob.id}`,
    ];
    const existing = await db.cleanerPayAdjustment.findMany({
      where: { cleanerId: cleaner.id, sourceKey: { in: candidateKeys } },
      select: { sourceKey: true },
    });
    const alreadyAwarded = new Set(existing.map((e) => e.sourceKey).filter((k): k is string => k != null));

    const proposals = evaluateStreakBonuses(streak, alreadyAwarded, cleaner.id, anchorJob.id, bonuses);
    for (const p of proposals) {
      const label =
        p.source === "STREAK_5"
          ? `Streak bonus — ${bonuses.streakLength} consecutive ≥${bonuses.streakMinScore} cleans`
          : `Streak bonus — ${bonuses.extendedStreakLength} consecutive ≥${bonuses.streakMinScore} cleans`;
      await db.cleanerPayAdjustment.create({
        data: {
          jobId: anchorJob.id,
          propertyId: anchorJob.propertyId,
          cleanerId: cleaner.id,
          scope: PayAdjustmentScope.JOB,
          title: label,
          type: PayAdjustmentType.FIXED,
          requestedAmount: p.amount,
          status: PayAdjustmentStatus.PENDING,
          cleanerNote: null,
          adminNote: `Auto-proposed quality streak bonus: ${label}. Anchored to the clean completing the streak. Approve to include in payroll.`,
          source: p.source,
          sourceKey: p.sourceKey,
        },
      });
      streakProposals++;
      newlyProposedCleaners.add(cleaner.id);
    }
  }

  // ── Monthly ranking ────────────────────────────────────────────────────────
  let monthlyProposals = 0;
  const targetMonth =
    options.month ?? (isFirstOfMonthSydney(now) ? previousMonthKey(now) : null);

  if (targetMonth) {
    const { start, end } = monthRange(targetMonth);
    const rows: MonthlyRankingRow[] = [];

    for (const cleaner of cleaners) {
      const jobs = await db.job.findMany({
        where: {
          status: JobStatus.COMPLETED,
          completedAt: { gte: start, lt: end },
          assignments: { some: { userId: cleaner.id } },
          qaReviews: { some: {} },
        },
        select: {
          qaReviews: { select: { score: true, kind: true, createdAt: true, managementReview: true } },
        },
      });
      const scores = jobs
        .map((j) => pickAuthoritative(j.qaReviews as QaReviewLite[])?.score)
        .filter((s): s is number => typeof s === "number");
      if (scores.length === 0) continue;
      rows.push({
        cleanerId: cleaner.id,
        cleans: scores.length,
        avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
      });
    }

    const proposals = evaluateMonthlyRanking(rows, targetMonth, bonuses);
    for (const p of proposals) {
      const existing = await db.cleanerPayAdjustment.findFirst({
        where: { source: p.source, sourceKey: p.sourceKey },
        select: { id: true },
      });
      if (existing) continue;
      const rank = p.source === "MONTHLY_RANK_1" ? 1 : 2;
      const title = `Monthly quality ranking — #${rank} (${monthLabel(targetMonth)})`;
      await db.cleanerPayAdjustment.create({
        data: {
          cleanerId: p.cleanerId,
          scope: PayAdjustmentScope.STANDALONE,
          title,
          type: PayAdjustmentType.FIXED,
          requestedAmount: p.amount,
          status: PayAdjustmentStatus.PENDING,
          cleanerNote: null,
          adminNote: `Auto-proposed monthly quality bonus: ranked #${rank} for ${monthLabel(
            targetMonth,
          )} (min ${bonuses.monthlyMinCleans} cleans, avg ≥ ${bonuses.monthlyMinAvgScore}). Approve to include in payroll.`,
          source: p.source,
          sourceKey: p.sourceKey,
        },
      });
      monthlyProposals++;
      newlyProposedCleaners.add(p.cleanerId);
    }
  }

  // ── Notify admins of any new proposals ───────────────────────────────────────
  const totalNew = streakProposals + monthlyProposals;
  if (totalNew > 0) {
    try {
      const admins = await db.user.findMany({
        where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
        select: { id: true, role: true, email: true, phone: true, name: true },
      });
      if (admins.length > 0) {
        const actionUrl = resolveAppUrl("/admin/pay-adjustments");
        const summary =
          `${totalNew} accountability bonus proposal${totalNew === 1 ? "" : "s"} awaiting approval` +
          ` (${streakProposals} streak, ${monthlyProposals} monthly) across ${newlyProposedCleaners.size} cleaner${
            newlyProposedCleaners.size === 1 ? "" : "s"
          }.`;
        const subject = `${settings.companyName}: ${totalNew} quality bonus proposal${
          totalNew === 1 ? "" : "s"
        } to review`;
        await deliverNotificationToRecipients({
          recipients: admins.map((a) => ({
            id: a.id,
            role: a.role,
            email: a.email,
            phone: a.phone,
            name: a.name,
          })),
          category: "approvals",
          url: actionUrl,
          web: { subject, body: summary },
          email: {
            subject,
            html: `<div style="font-family:Arial,sans-serif;color:#111;">
              <h2 style="margin:0 0 8px;">${subject}</h2>
              <p style="color:#555;margin:0 0 12px;">${summary} All proposals are PENDING and must be approved before they reach payroll.</p>
              <p style="margin:16px 0;"><a href="${actionUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;">Review bonus proposals</a></p>
            </div>`,
          },
        });
      }
    } catch (err) {
      logger.error({ err }, "[accountability-nightly] admin notification failed");
    }
  }

  return { streakProposals, monthlyProposals };
}
