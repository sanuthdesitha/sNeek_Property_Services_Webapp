import { db } from "@/lib/db";
import { getCleanerReworkStats } from "@/lib/qa/rework-transfers";
import { computeStreak, type CleanRecord } from "@/lib/accountability/streaks";
import { getAppSettings } from "@/lib/settings";
import { rangeFromKeys } from "@/lib/quality/period";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import {
  PERFORMANCE_MIN_SAMPLE,
  computeJobPerformanceFigures,
  type AttendanceFigure,
  type DisputeFigure,
  type DocumentationFigure,
  type NoShowFigure,
  type OnTimeFigure,
  type PerformanceJob,
  type PerformanceReview,
  type PunctualityFigure,
  type QualityFigure,
  type RatingFigure,
  type ReplyFigure,
} from "./performance-figures";

const PERF_KIND_PRIORITY: Record<string, number> = { QA: 3, ADMIN: 2, AUTO: 1 };

type PerfReviewLite = { score: number; kind: string; createdAt: Date; managementReview: boolean };

/** Authoritative review for a job (highest kind priority, then most recent). */
function pickAuthoritativeReview(reviews: PerfReviewLite[]): PerfReviewLite | null {
  if (!reviews || reviews.length === 0) return null;
  return reviews.reduce((best, current) => {
    const bestPriority = PERF_KIND_PRIORITY[best.kind] ?? 1;
    const currentPriority = PERF_KIND_PRIORITY[current.kind] ?? 1;
    if (currentPriority > bestPriority) return current;
    if (currentPriority === bestPriority && current.createdAt > best.createdAt) return current;
    return best;
  });
}

/** Jobs the accountability streak reads: the cleaner's latest completed+reviewed. */
export const ACCOUNTABILITY_STREAK_LOOKBACK = 10;

export const ACCOUNTABILITY_STREAK_JOB_SELECT = {
  qaReviews: { select: { score: true, kind: true, createdAt: true, managementReview: true } },
  qaIssues: { select: { severity: true } },
  feedback: { select: { rating: true } },
  satisfactionRating: { select: { score: true } },
} as const;

export type AccountabilityStreakJob = {
  qaReviews: PerfReviewLite[];
  qaIssues: Array<{ severity: string }>;
  feedback: { rating: number | null } | null;
  satisfactionRating: { score: number | null } | null;
};

export type AccountabilityStreakSummary = {
  currentStreak: number;
  last5Avg: number | null;
  last10Avg: number | null;
};

/**
 * Streak and last-5/last-10 averages from a cleaner's most recent completed,
 * reviewed jobs (newest first). Shared by getPerformanceMetrics and the Quality
 * hub's batched reader so both answer with the same rule.
 */
export function summariseAccountabilityStreak(
  jobs: readonly AccountabilityStreakJob[],
  streakMinScore: number,
): AccountabilityStreakSummary {
  const streakScores = jobs
    .map((j) => pickAuthoritativeReview(j.qaReviews)?.score)
    .filter((s): s is number => typeof s === "number");
  const last5 = streakScores.slice(0, 5);
  const last10 = streakScores.slice(0, 10);
  const last5Avg = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length : null;
  const last10Avg = last10.length > 0 ? last10.reduce((a, b) => a + b, 0) / last10.length : null;
  const streakRecords: CleanRecord[] = jobs.map((j) => {
    const review = pickAuthoritativeReview(j.qaReviews);
    return {
      score: review?.score ?? null,
      hadCritical:
        (review?.managementReview ?? false) ||
        j.qaIssues.some((i) => i.severity === "CRITICAL"),
      hadComplaint:
        (j.feedback?.rating != null && j.feedback.rating <= 2) ||
        (j.satisfactionRating?.score != null && j.satisfactionRating.score <= 2),
      hadMissingEvidence: false,
    };
  });
  return { currentStreak: computeStreak(streakRecords, streakMinScore), last5Avg, last10Avg };
}

/**
 * Wrap a Prisma promise so a failure logs (instead of silently producing `null`
 * metrics) and returns the fallback. Critical for diagnosing schema-mismatch
 * bugs — previously all queries swallowed errors and the UI rendered "—" with
 * no signal that anything was wrong.
 */
function safeQuery<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  return p.catch((err) => {
    console.warn(`[performance:${label}] query failed`, err instanceof Error ? err.message : err);
    return fallback;
  });
}

/**
 * Cleaner performance metrics for one window (30 / 90 / 365 Sydney days,
 * today included). The People › Cleaners columns, the person page KPIs, the
 * classic cleaner screens and the workforce performance page all read this
 * one function, so they show the same figure for the same cleaner.
 *
 * Every job-based figure is worked out by lib/workforce/performance-figures.ts
 * from the jobs and offers read here; its header states each basis. A figure
 * with fewer than PERFORMANCE_MIN_SAMPLE records is null ("Not enough data")
 * and its counts are still returned, never turned into 0 or 100%.
 *
 * The two reads every job figure depends on (the cleaner's jobs and offers)
 * are not swallowed: if they fail, this throws and the caller shows the
 * window as "not worked out". The side reads (documents, training, reworks,
 * streak) keep their logged fallbacks.
 */
export interface PerformanceMetrics {
  userId: string;
  windowDays: number;
  windowStart: Date;
  /** Records a rate or average needs before it is shown. */
  minimumSample: number;
  /** Finished jobs in the window (the page's job count; see performance-figures). */
  finishedJobs: number;
  quality: QualityFigure;
  reliability: OnTimeFigure;
  punctuality: PunctualityFigure;
  attendance: AttendanceFigure;
  documentation: DocumentationFigure;
  customerSatisfaction: RatingFigure;
  responseRate: ReplyFigure;
  disputeRate: DisputeFigure;
  noShowRate: NoShowFigure;
  documentCompliance: {
    current: number;
    expired: number;
    percent: number | null;
  };
  trainingCompletion: {
    completed: number;
    assigned: number;
    percent: number | null;
  };
  /**
   * Confirmed QA rework / miss rate — admin-approved QaReworkTransfer records
   * reviewed in the window where the cleaner missed work the QA had to redo.
   * `percent` is reworks per finished job (×100). Shown as its own figure; it
   * no longer lowers the quality score, which is the Quality hub's average.
   */
  reworkRate: {
    reworks: number;
    majorReworks: number;
    minutesLost: number;
    amountLost: number;
    totalJobs: number;
    percent: number | null;
  };
  /**
   * Accountability streak view (ADDITIVE, all-time — not window-scoped). Uses
   * authoritative QA review scores (kind priority QA>ADMIN>AUTO) of the cleaner's
   * most recent COMPLETED+reviewed jobs.
   *  - currentStreak: consecutive qualifying cleans counting back from the most
   *    recent (qualify = score ≥ streakMinScore & no critical/complaint).
   *  - last5Avg / last10Avg: mean authoritative score over the last 5 / 10
   *    completed+reviewed jobs (null when there are none).
   */
  currentStreak: number;
  last5Avg: number | null;
  last10Avg: number | null;
}

/** A fully-empty metrics object — used as a graceful fallback when a window
 *  errors or times out, so the performance page never 500s/502s. */
export function emptyPerformanceMetrics(userId: string, windowDays: number): PerformanceMetrics {
  return {
    userId,
    windowDays,
    windowStart: performanceWindow(windowDays).start,
    minimumSample: PERFORMANCE_MIN_SAMPLE,
    finishedJobs: 0,
    quality: { score: null, sampleSize: 0, jobs: 0 },
    reliability: { onTimePercent: null, sampleSize: 0, onTime: 0, jobs: 0, noClockIn: 0, noStartTime: 0 },
    punctuality: { avgMinutesLate: null, sampleSize: 0, jobs: 0, noClockIn: 0, noStartTime: 0 },
    attendance: { completedJobs: 0, assignedJobs: 0, percent: null, dueJobs: 0, notRecorded: 0 },
    documentation: { fullyDocumentedPercent: null, sampleSize: 0, documented: 0, withoutForm: 0, formWithoutPhotos: 0 },
    customerSatisfaction: { avgRating: null, sampleSize: 0, jobs: 0 },
    responseRate: { acceptedPercent: null, sampleSize: 0, repliedWithinHour: 0, officeAccepted: 0 },
    disputeRate: { disputes: 0, totalJobs: 0, percent: null },
    noShowRate: { noShows: 0, scheduled: 0, percent: null, notRecorded: 0 },
    documentCompliance: { current: 0, expired: 0, percent: null },
    trainingCompletion: { completed: 0, assigned: 0, percent: null },
    reworkRate: { reworks: 0, majorReworks: 0, minutesLost: 0, amountLost: 0, totalJobs: 0, percent: null },
    currentStreak: 0,
    last5Avg: null,
    last10Avg: null,
  };
}

/** The window's Sydney days: today and the N − 1 days before it. */
export function performanceWindow(windowDays: number, now: Date = new Date()): { start: Date; end: Date; todayKey: string } {
  const todayKey = sydneyTodayKey(now);
  const range = rangeFromKeys(addDaysToKey(todayKey, -(windowDays - 1)), todayKey);
  return { start: range.start as Date, end: range.end, todayKey };
}

/** Staff document statuses that are not a document on file (People list rule). */
const NOT_ON_FILE_DOCUMENT_STATUSES = new Set(["REJECTED"]);

type PerformanceJobRow = {
  id: string;
  status: string;
  scheduledDate: Date;
  startTime: string | null;
  cleanSkipStatus: string;
  timeLogs: Array<{ startedAt: Date }>;
  formSubmissions: Array<{ submittedById: string; _count: { media: number } }>;
  qaReviews: PerformanceReview[];
  issueTickets: Array<{ id: string }>;
  feedback: { rating: number | null; submittedAt: Date | null } | null;
  satisfactionRating: { score: number } | null;
};

function toPerformanceJob(row: PerformanceJobRow): PerformanceJob {
  const feedbackRating = row.feedback?.submittedAt && typeof row.feedback.rating === "number" ? row.feedback.rating : null;
  return {
    jobId: row.id,
    status: row.status,
    scheduledDate: row.scheduledDate,
    startTime: row.startTime,
    cleanSkipStatus: row.cleanSkipStatus,
    clockIns: row.timeLogs.map((log) => log.startedAt),
    submissions: row.formSubmissions.map((submission) => ({ submittedById: submission.submittedById, photoCount: submission._count.media })),
    reviews: row.qaReviews,
    disputeCases: row.issueTickets.length,
    rating: feedbackRating ?? row.satisfactionRating?.score ?? null,
  };
}

export async function getPerformanceMetrics(
  userId: string,
  windowDays = 30,
  now: Date = new Date(),
): Promise<PerformanceMetrics> {
  const window = performanceWindow(windowDays, now);
  const windowStart = window.start;

  const [jobRows, offerRows, documentRows, learningRows] = await Promise.all([
    db.job.findMany({
      where: {
        assignments: { some: { userId, removedAt: null } },
        scheduledDate: { gte: window.start, lt: window.end },
      },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        startTime: true,
        cleanSkipStatus: true,
        timeLogs: { where: { userId }, select: { startedAt: true } },
        formSubmissions: { select: { submittedById: true, _count: { select: { media: true } } } },
        qaReviews: { select: { score: true, kind: true, createdAt: true } },
        issueTickets: { where: { caseType: "CLIENT_DISPUTE", state: { not: "CANCELLED" } }, select: { id: true } },
        feedback: { select: { rating: true, submittedAt: true } },
        satisfactionRating: { select: { score: true } },
      },
    }) as Promise<PerformanceJobRow[]>,
    db.jobAssignment.findMany({
      where: { userId, offeredAt: { gte: window.start, lt: window.end } },
      select: { offeredAt: true, respondedAt: true, responseStatus: true, responseNote: true },
    }),
    safeQuery(
      "staffDocument",
      db.staffDocument.findMany({
        where: { userId },
        select: { expiresAt: true, status: true },
      }),
      [] as Array<{ expiresAt: Date | null; status: string }>,
    ),
    safeQuery(
      "learningAssignment",
      db.learningAssignment.findMany({
        where: { userId },
        select: { completedAt: true, status: true },
      }),
      [] as Array<{ completedAt: Date | null; status: string }>,
    ),
  ]);

  // Confirmed QA reworks reviewed in the window (their own figure).
  const reworkStats = await safeQuery(
    "qaReworkTransfer",
    getCleanerReworkStats(userId, windowStart),
    { count: 0, minutes: 0, amount: 0, major: 0 },
  );

  // Accountability streak/lastN (additive, all-time). One extra query for the
  // cleaner's most recent COMPLETED+reviewed jobs; authoritative score per job.
  const streakJobs = await safeQuery(
    "accountabilityStreak",
    db.job.findMany({
      where: {
        status: "COMPLETED",
        assignments: { some: { userId } },
        qaReviews: { some: {} },
      },
      orderBy: { completedAt: "desc" },
      take: ACCOUNTABILITY_STREAK_LOOKBACK,
      select: ACCOUNTABILITY_STREAK_JOB_SELECT,
    }),
    [] as AccountabilityStreakJob[],
  );
  const streakMinScore = await safeQuery(
    "accountabilitySettings",
    getAppSettings().then((s) => s.accountability.bonuses.streakMinScore),
    97,
  );

  const { currentStreak, last5Avg, last10Avg } = summariseAccountabilityStreak(streakJobs, streakMinScore);

  const figures = computeJobPerformanceFigures({
    userId,
    todayKey: window.todayKey,
    jobs: jobRows.map(toPerformanceJob),
    offers: offerRows.map((row) => ({ ...row, responseStatus: String(row.responseStatus) })),
    now,
  });

  // Documents current: documents on file (not rejected) that have not expired.
  const onFile = documentRows.filter((d) => !NOT_ON_FILE_DOCUMENT_STATUSES.has(d.status));
  const currentDocs = onFile.filter((d) => d.status !== "EXPIRED" && (!d.expiresAt || d.expiresAt > now)).length;
  const expiredDocs = onFile.length - currentDocs;
  const docCompliancePct = onFile.length > 0 ? Math.round((currentDocs / onFile.length) * 100) : null;

  // Training completion — learning assignments completed out of those assigned.
  const completedLearning = learningRows.filter((l) => l.completedAt || l.status === "COMPLETED").length;
  const trainingPct = learningRows.length > 0 ? Math.round((completedLearning / learningRows.length) * 100) : null;

  const finished = figures.finishedJobs;
  return {
    userId,
    windowDays,
    windowStart,
    minimumSample: PERFORMANCE_MIN_SAMPLE,
    ...figures,
    documentCompliance: {
      current: currentDocs,
      expired: expiredDocs,
      percent: docCompliancePct,
    },
    trainingCompletion: {
      completed: completedLearning,
      assigned: learningRows.length,
      percent: trainingPct,
    },
    reworkRate: {
      reworks: reworkStats.count,
      majorReworks: reworkStats.major,
      minutesLost: reworkStats.minutes,
      amountLost: reworkStats.amount,
      totalJobs: finished,
      percent: finished >= PERFORMANCE_MIN_SAMPLE ? Math.round((reworkStats.count / finished) * 100 * 10) / 10 : null,
    },
    currentStreak,
    last5Avg,
    last10Avg,
  };
}

/**
 * Convenience helper: fetch metrics for multiple cleaners over a single window in parallel.
 */
export async function getPerformanceMetricsForUsers(
  userIds: string[],
  windowDays = 30,
): Promise<PerformanceMetrics[]> {
  return Promise.all(userIds.map((id) => getPerformanceMetrics(id, windowDays)));
}
