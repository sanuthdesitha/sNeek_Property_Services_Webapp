import "server-only";
/**
 * Batch reads behind the Properties list: one query per fact for the whole
 * property set, never one per row. Each fact is read from the table that owns
 * it; nothing here writes.
 */
import { JobStatus, LaundryStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { pickAuthoritativeReview } from "@/lib/quality/authority";
import { detectExceptions, type PipelineExceptionCode } from "@/lib/laundry/pipeline";
import { CARE_KIND } from "@/lib/property-care/policy";
import { addDaysToKey, sydneyDateKey, sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import { QA_WINDOW_DAYS, type NextClean } from "./portfolio-options";

/** Statuses of a clean still to happen (or happening now). */
export const UPCOMING_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
  JobStatus.WAITING_CONTINUATION_APPROVAL,
];

const OPEN_LAUNDRY: LaundryStatus[] = [LaundryStatus.PENDING, LaundryStatus.CONFIRMED, LaundryStatus.FLAGGED, LaundryStatus.PICKED_UP];
const LATE_CODES: ReadonlySet<PipelineExceptionCode> = new Set<PipelineExceptionCode>(["PICKUP_OVERDUE", "DROP_OVERDUE", "OVER_TURNAROUND"]);

/** Latest failed sync run per property, for "Failed 6 h". */
export async function loadLatestSyncErrors(propertyIds: string[]): Promise<Map<string, Date>> {
  if (propertyIds.length === 0) return new Map();
  const runs = await db.icalSyncRun.findMany({
    where: { propertyId: { in: propertyIds }, status: "ERROR" },
    orderBy: { createdAt: "desc" },
    distinct: ["propertyId"],
    select: { propertyId: true, createdAt: true },
  });
  return new Map(runs.map((run) => [run.propertyId, run.createdAt]));
}

/** The next clean still to happen per property, from today (Sydney day). */
export async function loadNextCleans(propertyIds: string[], now: Date): Promise<Map<string, NextClean>> {
  if (propertyIds.length === 0) return new Map();
  const jobs = await db.job.findMany({
    where: {
      propertyId: { in: propertyIds },
      status: { in: UPCOMING_JOB_STATUSES },
      scheduledDate: { gte: sydneyDayStart(sydneyTodayKey(now)) },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    distinct: ["propertyId"],
    select: { id: true, jobNumber: true, propertyId: true, scheduledDate: true, startTime: true, status: true },
  });
  return new Map(
    jobs.map((job) => [
      job.propertyId,
      { jobId: job.id, jobNumber: job.jobNumber, dayKey: sydneyDateKey(job.scheduledDate), startTime: job.startTime, status: job.status },
    ]),
  );
}

/** Authoritative QA scores of cleans scheduled in the last 30 days, per property. */
export async function loadQaScores(propertyIds: string[], now: Date): Promise<Map<string, number[]>> {
  if (propertyIds.length === 0) return new Map();
  const from = sydneyDayStart(addDaysToKey(sydneyTodayKey(now), -QA_WINDOW_DAYS));
  const reviews = await db.qAReview.findMany({
    where: { job: { propertyId: { in: propertyIds }, scheduledDate: { gte: from, lte: now }, status: { not: JobStatus.CANCELLED } } },
    select: { jobId: true, kind: true, createdAt: true, score: true, job: { select: { propertyId: true } } },
  });
  const byJob = new Map<string, typeof reviews>();
  for (const review of reviews) byJob.set(review.jobId, [...(byJob.get(review.jobId) ?? []), review]);
  const scores = new Map<string, number[]>();
  for (const jobReviews of Array.from(byJob.values())) {
    const authoritative = pickAuthoritativeReview(jobReviews);
    if (!authoritative) continue;
    const propertyId = authoritative.job.propertyId;
    scores.set(propertyId, [...(scores.get(propertyId) ?? []), authoritative.score]);
  }
  return scores;
}

/**
 * Open laundry runs that the Laundry pipeline itself would call late (pickup
 * or drop overdue, or over turnaround), per property. Same detector and
 * settings as the pipeline; runs for cancelled jobs and runs with no pickup
 * required are not counted.
 */
export async function loadLateLaundry(propertyIds: string[], now: Date): Promise<Map<string, number>> {
  if (propertyIds.length === 0) return new Map();
  const todayKey = sydneyTodayKey(now);
  const [tasks, settings] = await Promise.all([
    db.laundryTask.findMany({
      where: {
        propertyId: { in: propertyIds },
        status: { in: OPEN_LAUNDRY },
        noPickupRequired: false,
        pickupDate: { lt: sydneyDayStart(addDaysToKey(todayKey, 1)) },
        job: { status: { not: JobStatus.CANCELLED } },
      },
      select: { propertyId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, droppedAt: true, flagReason: true, supplier: { select: { avgTurnaround: true } } },
    }),
    getAppSettings(),
  ]);
  const pipelineSettings = {
    maxOutdoorDays: settings.laundryOperations?.maxOutdoorDays ?? 3,
    requireDropoffPhoto: settings.laundryPortalVisibility?.requireDropoffPhoto === true,
  };
  const late = new Map<string, number>();
  for (const task of tasks) {
    const codes = detectExceptions(task, { todayKey, now, settings: pipelineSettings }).map((exception) => exception.code);
    if (codes.some((code) => LATE_CODES.has(code))) late.set(task.propertyId, (late.get(task.propertyId) ?? 0) + 1);
  }
  return late;
}

/** Open property-care tasks per property (attached to a job or waiting for a suitable one). */
export async function loadOpenCare(propertyIds: string[]): Promise<Map<string, number>> {
  if (propertyIds.length === 0) return new Map();
  const tasks = await db.jobTask.findMany({
    where: { propertyId: { in: propertyIds }, executionStatus: "OPEN", metadata: { path: ["kind"], equals: CARE_KIND } },
    select: { propertyId: true },
  });
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.propertyId, (counts.get(task.propertyId) ?? 0) + 1);
  return counts;
}

/** Jobs scheduled today and the next six days, and how many of them have nobody assigned. */
export async function loadNextSevenDays(propertyIds: string[], now: Date): Promise<{ total: number; unassigned: number }> {
  if (propertyIds.length === 0) return { total: 0, unassigned: 0 };
  const todayKey = sydneyTodayKey(now);
  const range = { gte: sydneyDayStart(todayKey), lt: sydneyDayStart(addDaysToKey(todayKey, 7)) };
  const [total, unassigned] = await Promise.all([
    db.job.count({ where: { propertyId: { in: propertyIds }, scheduledDate: range, status: { not: JobStatus.CANCELLED } } }),
    db.job.count({ where: { propertyId: { in: propertyIds }, scheduledDate: range, status: JobStatus.UNASSIGNED } }),
  ]);
  return { total, unassigned };
}
