import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getPerformanceMetrics } from "@/lib/workforce/performance";

export const dynamic = "force-dynamic";

/**
 * Accountability OVERVIEW (ADMIN / OPS_MANAGER).
 *
 * Per-cleaner quality accountability snapshot over a rolling window plus a
 * company-level roll-up. Scale is tiny (2-4 cleaners, ~10 properties) so we
 * batch every model with a single grouped/`IN` query and only fan out to
 * getPerformanceMetrics once per cleaner (streak / lastN).
 *
 * ?period=7d|30d|90d (default 30d).
 */

const KIND_PRIORITY: Record<string, number> = { QA: 3, ADMIN: 2, AUTO: 1 };

const RATING_KEYS = [
  "EXCELLENT",
  "PASS",
  "NEEDS_IMPROVEMENT",
  "FAILED",
  "MANAGEMENT_REVIEW",
] as const;
type RatingKey = (typeof RATING_KEYS)[number];

const SEVERITY_KEYS = ["MINOR", "MAJOR", "CRITICAL"] as const;
type SeverityKey = (typeof SEVERITY_KEYS)[number];

const COACHING_TYPES = ["COACHING", "WARNING", "MANAGEMENT_REVIEW"] as const;
type CoachingType = (typeof COACHING_TYPES)[number];

const OPEN_RECTIFICATION = ["PENDING", "RETURNED_TO_CLEANER", "NOT_FIXED", "ESCALATED"];
const BONUS_SOURCES = ["STREAK_5", "STREAK_10", "MONTHLY_RANK_1", "MONTHLY_RANK_2"];

function periodToDays(period: string | null): { key: string; days: number } {
  switch (period) {
    case "7d":
      return { key: "7d", days: 7 };
    case "90d":
      return { key: "90d", days: 90 };
    default:
      return { key: "30d", days: 30 };
  }
}

type ReviewLite = {
  jobId: string;
  score: number;
  kind: string;
  rating: string | null;
  managementReview: boolean;
  createdAt: Date;
  job: { assignments: { userId: string }[] } | null;
};

/** Authoritative review among a set (highest kind priority, then most recent). */
function pickAuthoritative(reviews: ReviewLite[]): ReviewLite {
  return reviews.reduce((best, cur) => {
    const bp = KIND_PRIORITY[best.kind] ?? 1;
    const cp = KIND_PRIORITY[cur.kind] ?? 1;
    if (cp > bp) return cur;
    if (cp === bp && cur.createdAt > best.createdAt) return cur;
    return best;
  });
}

/** Monday-anchored ISO week start (UTC) for weekly bucketing. */
function weekStart(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7; // 0 = Monday
  day.setUTCDate(day.getUTCDate() - dow);
  return day.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const { key: period, days } = periodToDays(new URL(req.url).searchParams.get("period"));
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const settings = await getAppSettings().catch(() => null);
    const categoryLabels = new Map<string, string>(
      (settings?.accountability.issueCategories ?? []).map((c) => [c.key, c.label]),
    );
    const labelFor = (key: string) => categoryLabels.get(key) ?? key;

    const [cleaners, reviews, issues, coaching, bonuses] = await Promise.all([
      db.user
        .findMany({
          where: { role: Role.CLEANER, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
        .catch(() => [] as { id: string; name: string | null }[]),
      db.qAReview
        .findMany({
          where: { createdAt: { gte: windowStart } },
          select: {
            jobId: true,
            score: true,
            kind: true,
            rating: true,
            managementReview: true,
            createdAt: true,
            job: { select: { assignments: { select: { userId: true } } } },
          },
        })
        .catch(() => [] as ReviewLite[]),
      db.qaIssue
        .findMany({
          where: { createdAt: { gte: windowStart } },
          select: {
            cleanerId: true,
            category: true,
            severity: true,
            rectificationStatus: true,
            falseConfirmation: true,
          },
        })
        .catch(() => [] as any[]),
      db.coachingRecord
        .findMany({
          where: { status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED"] as any } },
          select: { cleanerId: true, type: true },
        })
        .catch(() => [] as { cleanerId: string; type: string }[]),
      db.cleanerPayAdjustment
        .findMany({
          where: { status: "PENDING" as any, source: { in: BONUS_SOURCES } },
          select: { cleanerId: true, source: true, requestedAmount: true },
        })
        .catch(() => [] as { cleanerId: string; source: string | null; requestedAmount: number }[]),
    ]);

    const cleanerIds = new Set(cleaners.map((c) => c.id));

    // ── Authoritative review per job (among the window's reviews) ──────────
    const byJob = new Map<string, ReviewLite[]>();
    for (const r of reviews as ReviewLite[]) {
      const arr = byJob.get(r.jobId);
      if (arr) arr.push(r);
      else byJob.set(r.jobId, [r]);
    }
    const authReviews: ReviewLite[] = [];
    for (const arr of Array.from(byJob.values())) authReviews.push(pickAuthoritative(arr));

    // Per-cleaner accumulator scaffold
    type Row = {
      cleanerId: string;
      name: string;
      cleansReviewed: number;
      scoreSum: number;
      scoreN: number;
      ratingCounts: Record<RatingKey, number>;
      issuesBySeverity: Record<SeverityKey, number>;
      categoryCounts: Map<string, number>;
      falseConfirmations: { suspected: number; confirmed: number };
      openRectifications: number;
      coaching: Record<CoachingType, number>;
      pendingBonuses: { count: number; amount: number };
    };
    const rows = new Map<string, Row>();
    for (const c of cleaners) {
      rows.set(c.id, {
        cleanerId: c.id,
        name: c.name ?? "Cleaner",
        cleansReviewed: 0,
        scoreSum: 0,
        scoreN: 0,
        ratingCounts: { EXCELLENT: 0, PASS: 0, NEEDS_IMPROVEMENT: 0, FAILED: 0, MANAGEMENT_REVIEW: 0 },
        issuesBySeverity: { MINOR: 0, MAJOR: 0, CRITICAL: 0 },
        categoryCounts: new Map(),
        falseConfirmations: { suspected: 0, confirmed: 0 },
        openRectifications: 0,
        coaching: { COACHING: 0, WARNING: 0, MANAGEMENT_REVIEW: 0 },
        pendingBonuses: { count: 0, amount: 0 },
      });
    }

    // ── Attribute authoritative reviews to their assigned cleaner(s) ───────
    const companyIssuesByCategory = new Map<string, number>();
    let managementReviewQueue = 0;
    const weekBuckets = new Map<string, { sum: number; n: number }>();

    for (const r of authReviews) {
      const assigned = (r.job?.assignments ?? [])
        .map((a) => a.userId)
        .filter((id) => cleanerIds.has(id));
      const effRating: RatingKey | null = r.managementReview
        ? "MANAGEMENT_REVIEW"
        : (RATING_KEYS as readonly string[]).includes(r.rating ?? "")
          ? (r.rating as RatingKey)
          : null;
      if (r.managementReview || r.rating === "MANAGEMENT_REVIEW") managementReviewQueue += 1;

      // company weekly bucket (one per job)
      const wk = weekStart(r.createdAt);
      const b = weekBuckets.get(wk) ?? { sum: 0, n: 0 };
      b.sum += r.score;
      b.n += 1;
      weekBuckets.set(wk, b);

      for (const id of assigned) {
        const row = rows.get(id);
        if (!row) continue;
        row.cleansReviewed += 1;
        row.scoreSum += r.score;
        row.scoreN += 1;
        if (effRating) row.ratingCounts[effRating] += 1;
      }
    }

    // ── Issues (per-cleaner + company + category×cleaner matrix) ───────────
    // matrix: category -> (cleanerId -> count)
    const matrix = new Map<string, Map<string, number>>();
    for (const i of issues as any[]) {
      companyIssuesByCategory.set(i.category, (companyIssuesByCategory.get(i.category) ?? 0) + 1);
      if (cleanerIds.has(i.cleanerId)) {
        let cell = matrix.get(i.category);
        if (!cell) {
          cell = new Map();
          matrix.set(i.category, cell);
        }
        cell.set(i.cleanerId, (cell.get(i.cleanerId) ?? 0) + 1);
      }
      const row = rows.get(i.cleanerId);
      if (!row) continue;
      if ((SEVERITY_KEYS as readonly string[]).includes(i.severity)) {
        row.issuesBySeverity[i.severity as SeverityKey] += 1;
      }
      row.categoryCounts.set(i.category, (row.categoryCounts.get(i.category) ?? 0) + 1);
      if (i.falseConfirmation === "SUSPECTED") row.falseConfirmations.suspected += 1;
      if (i.falseConfirmation === "CONFIRMED") row.falseConfirmations.confirmed += 1;
      if (OPEN_RECTIFICATION.includes(i.rectificationStatus)) row.openRectifications += 1;
    }

    // ── Coaching (open records by type) ────────────────────────────────────
    for (const c of coaching) {
      const row = rows.get(c.cleanerId);
      if (!row) continue;
      if ((COACHING_TYPES as readonly string[]).includes(c.type)) {
        row.coaching[c.type as CoachingType] += 1;
      }
    }

    // ── Pending bonus proposals ────────────────────────────────────────────
    for (const b of bonuses) {
      const row = rows.get(b.cleanerId);
      if (!row) continue;
      row.pendingBonuses.count += 1;
      row.pendingBonuses.amount += b.requestedAmount ?? 0;
    }

    // ── Streak / lastN (≤4 cleaners → per-cleaner call is fine) ─────────────
    const metrics = await Promise.all(
      cleaners.map((c) =>
        getPerformanceMetrics(c.id, days).catch(() => null),
      ),
    );
    const metricsById = new Map(cleaners.map((c, idx) => [c.id, metrics[idx]]));

    const cleanerRows = cleaners.map((c) => {
      const row = rows.get(c.id)!;
      const m = metricsById.get(c.id);
      const topCategories = Array.from(row.categoryCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([category, count]) => ({ category, label: labelFor(category), count }));
      return {
        cleanerId: row.cleanerId,
        name: row.name,
        cleansReviewed: row.cleansReviewed,
        avgScore: row.scoreN > 0 ? Math.round((row.scoreSum / row.scoreN) * 10) / 10 : null,
        ratingCounts: row.ratingCounts,
        issuesBySeverity: row.issuesBySeverity,
        topCategories,
        falseConfirmations: row.falseConfirmations,
        openRectifications: row.openRectifications,
        coaching: row.coaching,
        currentStreak: m?.currentStreak ?? 0,
        last5Avg: m?.last5Avg ?? null,
        last10Avg: m?.last10Avg ?? null,
        pendingBonuses: {
          count: row.pendingBonuses.count,
          amount: Math.round(row.pendingBonuses.amount * 100) / 100,
        },
      };
    });

    const weekly = Array.from(weekBuckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([weekStartDate, v]) => ({
        weekStart: weekStartDate,
        avgScore: v.n > 0 ? Math.round((v.sum / v.n) * 10) / 10 : null,
        count: v.n,
      }));

    const issuesByCategory = Array.from(companyIssuesByCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({ category, label: labelFor(category), count }));

    // category×cleaner matrix — only categories that actually occurred, sorted
    // by total, with a per-cleaner count map keyed by cleanerId.
    const categoryMatrix = Array.from(matrix.entries())
      .map(([category, cells]) => {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const [cid, n] of Array.from(cells.entries())) {
          counts[cid] = n;
          total += n;
        }
        return { category, label: labelFor(category), counts, total };
      })
      .sort((a, b) => b.total - a.total);

    const totalScoreN = authReviews.length;
    const totalScoreSum = authReviews.reduce((s, r) => s + r.score, 0);

    return NextResponse.json({
      period,
      windowStart: windowStart.toISOString(),
      generatedAt: new Date().toISOString(),
      cleaners: cleanerRows,
      company: {
        weekly,
        issuesByCategory,
        categoryMatrix,
        managementReviewQueue,
        totalCleansReviewed: totalScoreN,
        avgScore: totalScoreN > 0 ? Math.round((totalScoreSum / totalScoreN) * 10) / 10 : null,
      },
    });
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err?.message ?? "Could not load accountability overview." },
      { status },
    );
  }
}
