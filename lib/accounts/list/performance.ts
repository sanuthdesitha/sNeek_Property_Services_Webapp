/**
 * Per-cleaner performance figures for People › Cleaners, read exactly as the
 * old Cleaners roster read them (git 8c753d3 app/v2/admin/cleaners/page.tsx):
 *
 * - quality, customer rating, reliability, attendance: lib/workforce/performance
 *   `getPerformanceMetrics(userId, 30)`, bounded to 5 cleaners at a time and
 *   time-boxed to 10 s per cleaner. A cleaner whose read fails or times out
 *   gets `emptyPerformanceMetrics` (every figure null), so the list shows
 *   "–" rather than a made-up 0.
 * - hours, 30 d: completed time logs started in the last 30 days, summed and
 *   rounded to one decimal, as the roster grouped them. A cleaner with no log
 *   has a real 0; if the query fails every cleaner gets null.
 *
 * The figures are kept for a short time in this server process so the People
 * page header and the list request that follows (and paging or re-sorting it)
 * do not re-run the per-cleaner metrics each time.
 */
import "server-only";
import { db } from "@/lib/db";
import { emptyPerformanceMetrics, getPerformanceMetrics, type PerformanceMetrics } from "@/lib/workforce/performance";

export type CleanerPerformance = {
  /** Quality score over the window (QA submissions), 0–100. null = no figure. */
  quality: number | null;
  /** Average customer rating (1–5). null = no rating in the window. */
  rating: number | null;
  /** On-time arrival percent. null = no arrival in the window. */
  reliability: number | null;
  /** Completed of assigned jobs, percent. null = nothing assigned. */
  attendance: number | null;
  /** Logged hours over the window. null = the time logs could not be read. */
  hours30: number | null;
};

export type CleanerPerformanceMap = Map<string, CleanerPerformance>;

export const PERFORMANCE_WINDOW_DAYS = 30;
const CONCURRENCY = 5;
const PER_CLEANER_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;

type CacheEntry = { key: string; expiresAt: number; value: Promise<CleanerPerformanceMap> };
let cache: CacheEntry | null = null;

/** Tests only: forget the cached figures. */
export function resetCleanerPerformanceCache(): void {
  cache = null;
}

async function safeMetrics(userId: string): Promise<PerformanceMetrics> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getPerformanceMetrics(userId, PERFORMANCE_WINDOW_DAYS),
      new Promise<PerformanceMetrics>((resolve) => {
        timer = setTimeout(() => resolve(emptyPerformanceMetrics(userId, PERFORMANCE_WINDOW_DAYS)), PER_CLEANER_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return emptyPerformanceMetrics(userId, PERFORMANCE_WINDOW_DAYS);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function metricsFor(userIds: string[]): Promise<Map<string, PerformanceMetrics>> {
  const byId = new Map<string, PerformanceMetrics>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, userIds.length) }, async () => {
    while (cursor < userIds.length) {
      const userId = userIds[cursor];
      cursor += 1;
      byId.set(userId, await safeMetrics(userId));
    }
  });
  await Promise.all(workers);
  return byId;
}

async function hoursFor(userIds: string[], now: Date): Promise<Map<string, number> | null> {
  const since = new Date(now.getTime() - PERFORMANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    const rows = await db.timeLog.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, startedAt: { gte: since }, stoppedAt: { not: null } },
      _sum: { durationM: true },
    });
    return new Map(rows.map((row) => [row.userId, Math.round(((row._sum.durationM ?? 0) / 60) * 10) / 10]));
  } catch {
    return null;
  }
}

async function readPerformance(userIds: string[], now: Date): Promise<CleanerPerformanceMap> {
  const [metrics, hours] = await Promise.all([metricsFor(userIds), hoursFor(userIds, now)]);
  const result: CleanerPerformanceMap = new Map();
  for (const userId of userIds) {
    const m = metrics.get(userId) ?? emptyPerformanceMetrics(userId, PERFORMANCE_WINDOW_DAYS);
    result.set(userId, {
      quality: m.quality.score,
      rating: m.customerSatisfaction.avgRating,
      reliability: m.reliability.onTimePercent,
      attendance: m.attendance.percent,
      hours30: hours ? hours.get(userId) ?? 0 : null,
    });
  }
  return result;
}

/** Figures for these cleaners (ids are de-duplicated; order does not matter). */
export function loadCleanerPerformance(userIds: string[], now: Date = new Date()): Promise<CleanerPerformanceMap> {
  const ids = Array.from(new Set(userIds)).sort();
  if (ids.length === 0) return Promise.resolve(new Map());
  const key = ids.join(",");
  const at = Date.now();
  if (cache && cache.key === key && cache.expiresAt > at) return cache.value;
  const value = readPerformance(ids, now);
  const entry: CacheEntry = { key, expiresAt: at + CACHE_TTL_MS, value };
  cache = entry;
  // A failed read is not kept.
  value.catch(() => {
    if (cache === entry) cache = null;
  });
  return value;
}

/** Mean of the figures that exist; null when none do (never 0). */
export function averageOf(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}
