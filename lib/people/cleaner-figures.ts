/**
 * Header figures for People › Cleaners. They carry the Workforce overview's
 * KPIs (docs expired, expiring within 14 days, pending review, onboarding
 * done, kudos this month) and the Cleaners roster's (active cleaners, active
 * jobs, owed approved, avg quality, avg rating) onto the People page, computed
 * with the same services and rules those pages used. A figure that could not
 * be read, or has no data behind it, is null ("–"), never 0.
 *
 * Avg quality and Avg rating are the old roster's: the mean, over ACTIVE
 * cleaners that have one, of lib/workforce/performance's 30-day quality score
 * and customer rating (read through lib/accounts/list/performance, which the
 * Cleaners list uses for its Customer rating and Reliability columns). They
 * follow the workforce pack, the access that roster had.
 */
import "server-only";
import { JobStatus, PayAdjustmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getRecognitionBoard, listStaffDocumentRequestsForAdmin, listStaffDocumentsForAdmin } from "@/lib/workforce/service";
import { docExpiryStatus } from "@/components/v2/admin/workforce/utils";
import { averageOf, loadCleanerPerformance, type CleanerPerformanceMap } from "@/lib/accounts/list/performance";

export type CleanerFigures = {
  activeCleaners: number | null;
  activeJobs: number | null;
  owedApproved: number | null;
  /** Mean 30-day quality score (0–100) of active cleaners with one. */
  avgQuality: number | null;
  /** Mean 30-day customer rating (1–5) of active cleaners with one. */
  avgRating: number | null;
  docsExpired: number | null;
  docsExpiring: number | null;
  docsPendingReview: number | null;
  documentsRequested: number | null;
  onboardingDonePercent: number | null;
  kudosThisMonth: number | null;
};

/** Nothing read: for a viewer whose packs do not open the Cleaners tab. */
export const EMPTY_CLEANER_FIGURES: CleanerFigures = {
  activeCleaners: null,
  activeJobs: null,
  owedApproved: null,
  avgQuality: null,
  avgRating: null,
  docsExpired: null,
  docsExpiring: null,
  docsPendingReview: null,
  documentsRequested: null,
  onboardingDonePercent: null,
  kudosThisMonth: null,
};

const ACTIVE_JOB_STATUSES: JobStatus[] = [JobStatus.ASSIGNED, JobStatus.OFFERED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS, JobStatus.PAUSED];

async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch {
    return null;
  }
}

type PerformanceAverages = { avgQuality: number | null; avgRating: number | null };

/** The roster's averages: every CLEANER login is read (shared with the list), active ones averaged. */
async function performanceAverages(now: Date): Promise<PerformanceAverages> {
  const cleaners = await db.user.findMany({ where: { role: Role.CLEANER }, select: { id: true, isActive: true } });
  const performance: CleanerPerformanceMap = await loadCleanerPerformance(cleaners.map((cleaner) => cleaner.id), now);
  const active = cleaners.filter((cleaner) => cleaner.isActive).map((cleaner) => performance.get(cleaner.id));
  return {
    avgQuality: averageOf(active.map((figure) => figure?.quality ?? null)),
    avgRating: averageOf(active.map((figure) => figure?.rating ?? null)),
  };
}

export async function loadCleanerFigures(options: { workforce: boolean; pay: boolean }, now: Date = new Date()): Promise<CleanerFigures> {
  const [activeCleaners, activeJobs, owed, documents, requests, recognition, learnTotal, learnDone, averages] = await Promise.all([
    orNull(db.user.count({ where: { role: Role.CLEANER, isActive: true } })),
    orNull(db.jobAssignment.count({ where: { removedAt: null, user: { role: Role.CLEANER }, job: { status: { in: ACTIVE_JOB_STATUSES } } } })),
    options.pay ? orNull(db.cleanerPayAdjustment.aggregate({ where: { status: PayAdjustmentStatus.APPROVED }, _sum: { approvedAmount: true } })) : Promise.resolve(null),
    options.workforce ? orNull(listStaffDocumentsForAdmin()) : Promise.resolve(null),
    options.workforce ? orNull(listStaffDocumentRequestsForAdmin()) : Promise.resolve(null),
    options.workforce ? orNull(getRecognitionBoard()) : Promise.resolve(null),
    options.workforce ? orNull(db.learningAssignment.count()) : Promise.resolve(null),
    options.workforce ? orNull(db.learningAssignment.count({ where: { OR: [{ completedAt: { not: null } }, { status: "COMPLETED" }] } })) : Promise.resolve(null),
    options.workforce ? orNull(performanceAverages(now)) : Promise.resolve(null),
  ]);
  const at = now.getTime();
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return {
    activeCleaners,
    activeJobs,
    owedApproved: owed ? Number(Number(owed._sum.approvedAmount ?? 0).toFixed(2)) : null,
    avgQuality: averages?.avgQuality ?? null,
    avgRating: averages?.avgRating ?? null,
    docsExpired: documents ? documents.filter((doc) => docExpiryStatus(doc.expiresAt, at) === "EXPIRED").length : null,
    docsExpiring: documents ? documents.filter((doc) => docExpiryStatus(doc.expiresAt, at) === "EXPIRING_SOON").length : null,
    docsPendingReview: documents ? documents.filter((doc) => doc.status === "PENDING").length : null,
    documentsRequested: requests ? requests.filter((request) => request.status === "REQUESTED").length : null,
    onboardingDonePercent: learnTotal === null || learnDone === null ? null : learnTotal > 0 ? Math.round((learnDone / learnTotal) * 100) : null,
    kudosThisMonth: recognition ? recognition.recentRecognitions.filter((row) => new Date(row.createdAt) >= monthStart).length : null,
  };
}
