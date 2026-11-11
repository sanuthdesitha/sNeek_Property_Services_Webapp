/**
 * "Today at a glance" (below the fold on Command): what the old Command page
 * showed outside its attention list — today by status (now links into Jobs
 * filtered by that status), on shift now, upcoming six days, recent client
 * feedback, laundry due today, cleaners scheduled tomorrow and completed
 * today. Each figure is read on its own; a failed one is null, never zero.
 */
import { JobStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getDashboardMetrics } from "@/lib/admin/dashboard";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { STATUS_LABELS } from "@/lib/jobs/status-labels";
import { loadLiveBoard } from "@/lib/ops/live-board";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import { jobsByStatusTodayHref } from "./work-queue-links";
import type { GlancePayload, GlanceStatus, GlanceUpcoming } from "./command-types";

export const UPCOMING_DAYS = 6;
export const UPCOMING_ROWS = 6;

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED, JobStatus.OFFERED, JobStatus.ASSIGNED, JobStatus.EN_ROUTE, JobStatus.IN_PROGRESS,
  JobStatus.PAUSED, JobStatus.WAITING_CONTINUATION_APPROVAL, JobStatus.SUBMITTED, JobStatus.QA_REVIEW,
];

function utcDay(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function titleCase(value: string): string {
  return value.toLowerCase().split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch {
    return null;
  }
}

async function statusCounts(todayKey: string): Promise<GlanceStatus[]> {
  const jobs = await db.job.findMany({
    where: { scheduledDate: { gte: utcDay(todayKey), lt: utcDay(addDaysToKey(todayKey, 1)) } },
    select: { status: true, internalNotes: true },
  });
  const counts = new Map<JobStatus, number>();
  for (const job of jobs) {
    if (!parseJobInternalNotes(job.internalNotes).isDraft) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }
  return Object.values(JobStatus).map((status) => ({
    status,
    label: STATUS_LABELS[status] ?? titleCase(status),
    count: counts.get(status) ?? 0,
    href: jobsByStatusTodayHref(status, todayKey),
  }));
}

async function upcoming(todayKey: string): Promise<GlanceUpcoming[]> {
  const jobs = await db.job.findMany({
    where: {
      scheduledDate: { gte: utcDay(addDaysToKey(todayKey, 1)), lt: utcDay(addDaysToKey(todayKey, 1 + UPCOMING_DAYS)) },
      status: { in: ACTIVE_JOB_STATUSES },
    },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    take: 60,
    select: { id: true, jobType: true, internalNotes: true, status: true, startTime: true, scheduledDate: true, property: { select: { name: true } } },
  });
  return jobs
    .filter((job) => !parseJobInternalNotes(job.internalNotes).isDraft)
    .slice(0, UPCOMING_ROWS)
    .map((job) => ({
      id: job.id,
      propertyName: job.property?.name ?? "Property",
      // scheduledDate is a calendar key: format it in UTC so the day never shifts.
      when: `${formatInTimeZone(job.scheduledDate, "UTC", "EEE d MMM")}${job.startTime ? ` · ${job.startTime}` : ""}`,
      jobType: titleCase(job.jobType),
      statusLabel: STATUS_LABELS[job.status] ?? titleCase(job.status),
    }));
}

async function laundryDue(todayKey: string): Promise<number> {
  const range = { gte: utcDay(todayKey), lt: utcDay(addDaysToKey(todayKey, 1)) };
  return db.laundryTask.count({ where: { OR: [{ pickupDate: range }, { dropoffDate: range }] } });
}

export async function loadCommandGlance(now: Date, timeZone: string): Promise<GlancePayload> {
  const todayKey = sydneyTodayKey(now);
  const [statuses, board, next, metrics, laundry] = await Promise.all([
    orNull(statusCounts(todayKey)),
    orNull(loadLiveBoard({ now, timeZone, withProgress: false })),
    orNull(upcoming(todayKey)),
    orNull(getDashboardMetrics({ strict: true })),
    orNull(laundryDue(todayKey)),
  ]);
  return {
    statuses,
    onShift: board
      ? {
          travelling: board.counts.travelling + board.jobs.filter((job) => job.state === "late").length,
          onSite: board.counts.onSite,
          clockedIn: board.jobs.filter((job) => job.openTimeLogId).length,
        }
      : null,
    upcoming: next,
    feedback: metrics
      ? metrics.recentFeedback.map((fb) => ({ id: fb.id, jobId: fb.jobId, clientName: fb.client?.name ?? "Client", rating: fb.rating, comment: fb.comment }))
      : null,
    laundryDueToday: laundry,
    cleanersTomorrow: metrics ? metrics.tomorrow.scheduled : null,
    completedToday: metrics ? metrics.today.completed : null,
    todayKey,
  };
}
