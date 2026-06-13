import { db } from "@/lib/db";

/**
 * Per-staff-member summary stats for the Accounts hub detail page.
 *
 * Every metric comes from a real query and is defensive: any model that is
 * missing or whose relation is broken falls back to a safe zero/empty value so
 * the page renders rather than throwing. A stat that has no data source is
 * surfaced as `null` and omitted cleanly in the UI (never fabricated).
 *
 * Cleaner/QA KPIs (quality, on-time %, rework rate, etc.) are not duplicated
 * here — the page composes those from `getPerformanceMetrics` directly.
 */

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  return p.catch(() => fallback);
}

export interface RecentJobRow {
  id: string;
  jobNumber: string | null;
  jobType: string | null;
  status: string;
  scheduledDate: Date | null;
  propertyName: string | null;
  suburb: string | null;
  isPrimary: boolean;
}

export interface PayAdjustmentRow {
  id: string;
  title: string | null;
  type: string;
  status: string;
  requestedAmount: number;
  approvedAmount: number | null;
  requestedAt: Date;
}

export interface RecognitionRow {
  id: string;
  title: string;
  message: string | null;
  badgeKey: string;
  createdAt: Date;
}

export interface JobsTrendPoint {
  /** e.g. "Apr" — month label */
  label: string;
  jobs: number;
}

export interface UserSummary {
  userId: string;
  /** Total completed jobs the user was assigned to (all time). */
  jobsCompletedTotal: number;
  jobsCompletedThisMonth: number;
  /** Total assignments (any status) — useful denominator. */
  assignmentsTotal: number;
  /** Hours logged from TimeLog.durationM (all time), rounded to 1dp. */
  hoursLoggedTotal: number;
  hoursLoggedThisMonth: number;
  /** Approved pay adjustments total ($) and count. */
  approvedPayTotal: number;
  approvedPayCount: number;
  /** Pending pay/time adjustment counts (action items). */
  pendingPayAdjustments: number;
  pendingTimeAdjustments: number;
  /** Estimated earnings = hours logged × hourlyRate + approved pay adjustments. null if no hourlyRate. */
  estimatedEarnings: number | null;
  /** Staff documents: current vs expired. */
  documentsCurrent: number;
  documentsExpired: number;
  documentsTotal: number;
  /** Recognitions / kudos received (performances). */
  recognitionCount: number;
  recentJobs: RecentJobRow[];
  recentPayAdjustments: PayAdjustmentRow[];
  recentRecognitions: RecognitionRow[];
  /** Completed jobs per month for the last 6 months (oldest → newest). */
  jobsTrend: JobsTrendPoint[];
}

const COMPLETED_STATUSES = ["COMPLETED", "INVOICED"];

export async function getUserSummary(
  userId: string,
  hourlyRate: number | null,
): Promise<UserSummary> {
  const monthStart = startOfMonth();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5, 1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [assignments, timeLogs, payAdjustments, timeAdjPending, documents, recognitions] =
    await Promise.all([
      safe(
        db.jobAssignment.findMany({
          where: { userId, removedAt: null },
          select: {
            isPrimary: true,
            job: {
              select: {
                id: true,
                jobNumber: true,
                jobType: true,
                status: true,
                scheduledDate: true,
                updatedAt: true,
                property: { select: { name: true, suburb: true } },
              },
            },
          },
          orderBy: { assignedAt: "desc" },
          take: 400,
        }),
        [] as any[],
      ),
      safe(
        db.timeLog.findMany({
          where: { userId },
          select: { durationM: true, startedAt: true },
          take: 2000,
        }),
        [] as Array<{ durationM: number | null; startedAt: Date }>,
      ),
      safe(
        db.cleanerPayAdjustment.findMany({
          where: { cleanerId: userId },
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            requestedAmount: true,
            approvedAmount: true,
            requestedAt: true,
          },
          orderBy: { requestedAt: "desc" },
          take: 50,
        }),
        [] as any[],
      ),
      safe(
        db.timeLogAdjustmentRequest.count({
          where: { cleanerId: userId, status: "PENDING" },
        }),
        0,
      ),
      safe(
        db.staffDocument.findMany({
          where: { userId },
          select: { expiresAt: true },
        }),
        [] as Array<{ expiresAt: Date | null }>,
      ),
      safe(
        db.staffRecognition.findMany({
          where: { userId },
          select: { id: true, title: true, message: true, badgeKey: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        [] as any[],
      ),
    ]);

  // Jobs
  const completed = assignments.filter((a: any) => COMPLETED_STATUSES.includes(a.job?.status));
  const jobsCompletedTotal = completed.length;
  const jobsCompletedThisMonth = completed.filter((a: any) => {
    const when = a.job?.updatedAt ?? a.job?.scheduledDate;
    return when && new Date(when) >= monthStart;
  }).length;

  const recentJobs: RecentJobRow[] = assignments.slice(0, 12).map((a: any) => ({
    id: a.job?.id ?? "",
    jobNumber: a.job?.jobNumber ?? null,
    jobType: a.job?.jobType ?? null,
    status: a.job?.status ?? "UNKNOWN",
    scheduledDate: a.job?.scheduledDate ?? null,
    propertyName: a.job?.property?.name ?? null,
    suburb: a.job?.property?.suburb ?? null,
    isPrimary: !!a.isPrimary,
  }));

  // Jobs trend (completed per month, last 6 months)
  const monthBuckets: JobsTrendPoint[] = [];
  const bucketIndex = new Map<string, number>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    bucketIndex.set(key, monthBuckets.length);
    monthBuckets.push({ label: d.toLocaleDateString("en-AU", { month: "short" }), jobs: 0 });
  }
  for (const a of completed) {
    const when = (a as any).job?.updatedAt ?? (a as any).job?.scheduledDate;
    if (!when) continue;
    const dt = new Date(when);
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    const idx = bucketIndex.get(key);
    if (idx !== undefined) monthBuckets[idx].jobs += 1;
  }

  // Hours
  const totalMinutes = timeLogs.reduce((s, t) => s + (t.durationM ?? 0), 0);
  const monthMinutes = timeLogs
    .filter((t) => t.startedAt && new Date(t.startedAt) >= monthStart)
    .reduce((s, t) => s + (t.durationM ?? 0), 0);
  const hoursLoggedTotal = Math.round((totalMinutes / 60) * 10) / 10;
  const hoursLoggedThisMonth = Math.round((monthMinutes / 60) * 10) / 10;

  // Pay adjustments
  const approved = payAdjustments.filter((p: any) => p.status === "APPROVED");
  const approvedPayTotal = approved.reduce(
    (s: number, p: any) => s + Number(p.approvedAmount ?? p.requestedAmount ?? 0),
    0,
  );
  const pendingPayAdjustments = payAdjustments.filter((p: any) => p.status === "PENDING").length;
  const recentPayAdjustments: PayAdjustmentRow[] = payAdjustments.slice(0, 8).map((p: any) => ({
    id: p.id,
    title: p.title ?? null,
    type: p.type,
    status: p.status,
    requestedAmount: Number(p.requestedAmount ?? 0),
    approvedAmount: p.approvedAmount != null ? Number(p.approvedAmount) : null,
    requestedAt: p.requestedAt,
  }));

  // Documents
  const now = new Date();
  const documentsTotal = documents.length;
  const documentsCurrent = documents.filter((d) => !d.expiresAt || new Date(d.expiresAt) > now).length;
  const documentsExpired = documentsTotal - documentsCurrent;

  // Recognitions
  const recentRecognitions: RecognitionRow[] = recognitions.slice(0, 8).map((r: any) => ({
    id: r.id,
    title: r.title,
    message: r.message ?? null,
    badgeKey: r.badgeKey,
    createdAt: r.createdAt,
  }));

  // Earnings estimate
  const estimatedEarnings =
    hourlyRate != null
      ? Math.round((hoursLoggedTotal * hourlyRate + approvedPayTotal) * 100) / 100
      : approvedPayTotal > 0
        ? approvedPayTotal
        : null;

  return {
    userId,
    jobsCompletedTotal,
    jobsCompletedThisMonth,
    assignmentsTotal: assignments.length,
    hoursLoggedTotal,
    hoursLoggedThisMonth,
    approvedPayTotal,
    approvedPayCount: approved.length,
    pendingPayAdjustments,
    pendingTimeAdjustments: timeAdjPending,
    estimatedEarnings,
    documentsCurrent,
    documentsExpired,
    documentsTotal,
    recognitionCount: recognitions.length,
    recentJobs,
    recentPayAdjustments,
    recentRecognitions,
    jobsTrend: monthBuckets,
  };
}
