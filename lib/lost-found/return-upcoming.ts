import "server-only";
/**
 * Upcoming cleans at a property, offered to the guest as pickup times and to
 * the office as the job picker (2026-11-20). Not cancelled and not finished,
 * scheduled today or later in the organisation calendar. `scheduledDate` is
 * the clean's calendar date stored at UTC midnight, so the day is read from it
 * unshifted. The guest gets the date and a broad window only: no cleaner, no
 * access detail, no exact start.
 */
import { JobStatus, type Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { timeWindowLabel } from "./return-rules";
import type { UpcomingCleanOption } from "./return-view-types";

export const NOT_UPCOMING_STATUSES: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED, JobStatus.CANCELLED];

type Reader = Pick<Prisma.TransactionClient, "job">;

export function jobDay(scheduledDate: Date): string {
  return scheduledDate.toISOString().slice(0, 10);
}

function upcomingWhere(propertyId: string, timeZone: string, now: Date): Prisma.JobWhereInput {
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return { propertyId, status: { notIn: NOT_UPCOMING_STATUSES }, scheduledDate: { gte: new Date(`${today}T00:00:00.000Z`) } };
}

export async function upcomingCleansForGuest(propertyId: string | null, limit: number, timeZone: string, now: Date = new Date(), reader: Reader = db): Promise<UpcomingCleanOption[]> {
  if (!propertyId) return [];
  const jobs = await reader.job.findMany({
    where: upcomingWhere(propertyId, timeZone, now),
    select: { id: true, scheduledDate: true, startTime: true },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    take: limit,
  });
  return jobs.map((job) => ({ jobId: job.id, date: jobDay(job.scheduledDate), window: timeWindowLabel(job.startTime) }));
}

export type OfficeUpcomingJob = { id: string; jobNumber: string | null; date: string; window: string; cleanerNames: string[] };

export async function upcomingJobsForOffice(propertyId: string | null, timeZone: string, now: Date = new Date()): Promise<OfficeUpcomingJob[]> {
  if (!propertyId) return [];
  const jobs = await db.job.findMany({
    where: upcomingWhere(propertyId, timeZone, now),
    select: { id: true, jobNumber: true, scheduledDate: true, startTime: true, assignments: { where: { removedAt: null }, select: { user: { select: { name: true, email: true } } } } },
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    take: 20,
  });
  return jobs.map((job) => ({
    id: job.id,
    jobNumber: job.jobNumber ?? null,
    date: jobDay(job.scheduledDate),
    window: job.startTime ? `${timeWindowLabel(job.startTime)} (${job.startTime})` : timeWindowLabel(null),
    cleanerNames: job.assignments.map((row) => row.user.name?.trim() || row.user.email),
  }));
}

/** Is this job an upcoming clean at the property right now? Used before a task is put on it. */
export async function isUpcomingJobAtProperty(reader: Reader, jobId: string, propertyId: string, timeZone: string, now: Date = new Date()): Promise<{ id: string; scheduledDate: Date; jobNumber: string | null } | null> {
  return reader.job.findFirst({ where: { id: jobId, ...upcomingWhere(propertyId, timeZone, now) }, select: { id: true, scheduledDate: true, jobNumber: true } });
}
