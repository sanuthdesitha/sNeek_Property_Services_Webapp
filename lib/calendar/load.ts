import "server-only";
import { Role, type JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { loadLeaveForUsers } from "@/lib/accounts/leave";
import { leaveOnDay, leaveReason, type LeaveEntry } from "@/lib/accounts/leave-rules";
import { dayAvailabilityBlocker } from "@/lib/jobs/cleaner-suggestions";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { addDaysToKey, sydneyTodayKey } from "@/lib/time/sydney-range";
import { calendarMoveBlock } from "./move-rules";
import { HOURS_BASIS, chipCategory, guestArrivalOnDay, isJobLate, jobScheduledHours } from "./presentation";
import { buildRows, type RowSource } from "./rows";
import { dayKeyToUtcDate, listDays, utcDateToDayKey, type CalendarRange } from "./range";
import type { CalendarJob, CalendarLaundryDay, CalendarResponse } from "./types";
import { NOT_VOIDED } from "@/lib/laundry/void-scope";

/** One response carries at most this many jobs; more sets `truncated`. */
export const CALENDAR_JOB_LIMIT = 3000;

export type CalendarFilters = {
  rowsMode: "cleaners" | "properties";
  statuses: JobStatus[] | null;
  clientId: string | null;
  unassignedOnly: boolean;
  includeLaundry: boolean;
};

const JOB_SELECT = {
  id: true, jobNumber: true, status: true, jobType: true, scheduledDate: true, startTime: true, endTime: true,
  dueTime: true, estimatedHours: true, cleanSkipStatus: true, internalNotes: true, sameDayCheckin: true,
  sameDayCheckinTime: true, manuallyRescheduledAt: true, updatedAt: true, propertyId: true,
  property: { select: { name: true, address: true, suburb: true, client: { select: { id: true, name: true } } } },
  assignments: {
    where: { removedAt: null },
    orderBy: { isPrimary: "desc" as const },
    select: { userId: true, isPrimary: true, user: { select: { name: true, email: true, isActive: true } } },
  },
  qaAssignments: {
    where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] as ("OPEN" | "ASSIGNED" | "IN_PROGRESS")[] } },
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, status: true, assignedToId: true, assignedTo: { select: { name: true, email: true } } },
  },
};

type JobRecord = Awaited<ReturnType<typeof loadJobRecords>>[number];

function loadJobRecords(range: CalendarRange) {
  return db.job.findMany({
    where: { scheduledDate: { gte: dayKeyToUtcDate(range.start), lt: dayKeyToUtcDate(addDaysToKey(range.end, 1)) } },
    select: JOB_SELECT,
    orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }, { id: "asc" }],
    take: CALENDAR_JOB_LIMIT + 1,
  });
}

function personName(user: { name: string | null; email: string | null }): string {
  return user.name?.trim() || user.email?.trim() || "Cleaner";
}

function toCalendarJob(record: JobRecord, now: Date): CalendarJob {
  const meta = parseJobInternalNotes(record.internalNotes);
  const day = utcDateToDayKey(record.scheduledDate);
  const skipped = record.cleanSkipStatus === "SKIPPED";
  const cleaners = record.assignments.map((row) => ({ id: row.userId, name: personName(row.user), isPrimary: row.isPrimary }));
  const qa = record.qaAssignments[0];
  return {
    id: record.id,
    jobNumber: record.jobNumber,
    propertyId: record.propertyId,
    propertyName: record.property?.name?.trim() || record.property?.address?.trim() || "Unlinked property",
    propertyMissingName: !record.property?.name?.trim(),
    suburb: record.property?.suburb ?? null,
    clientId: record.property?.client?.id ?? null,
    clientName: record.property?.client?.name ?? null,
    jobType: String(record.jobType),
    status: String(record.status),
    day,
    startTime: record.startTime,
    endTime: record.endTime,
    dueTime: record.dueTime,
    estimatedHours: record.estimatedHours,
    hours: skipped || record.status === "CANCELLED" ? null : jobScheduledHours(record),
    cleaners,
    skipped,
    late: isJobLate({ status: String(record.status), day, startTime: record.startTime, hasCleaner: cleaners.length > 0, skipped }, now),
    guestArrival: guestArrivalOnDay({
      day,
      reservationContext: meta.reservationContext,
      sameDayCheckin: record.sameDayCheckin,
      sameDayCheckinTime: record.sameDayCheckinTime,
      manuallyRescheduled: record.manuallyRescheduledAt != null,
    }),
    moveBlock: calendarMoveBlock({ status: String(record.status), skipped, isDraft: meta.isDraft }),
    updatedAt: record.updatedAt.toISOString(),
    qa: qa
      ? { id: qa.id, status: String(qa.status), assignedToId: qa.assignedToId, assignedToName: qa.assignedTo?.name ?? qa.assignedTo?.email ?? null }
      : null,
  };
}

/** The filters the page offers, applied to the range's jobs. */
export function matchesCalendarFilters(job: CalendarJob, filters: CalendarFilters): boolean {
  if (filters.statuses && !filters.statuses.includes(job.status as JobStatus)) return false;
  if (filters.clientId && job.clientId !== filters.clientId) return false;
  if (filters.unassignedOnly && job.cleaners.length > 0) return false;
  return true;
}

async function loadLaundryCounts(range: CalendarRange, clientId: string | null): Promise<Record<string, CalendarLaundryDay>> {
  const gte = dayKeyToUtcDate(range.start);
  const lt = dayKeyToUtcDate(addDaysToKey(range.end, 1));
  const tasks = await db.laundryTask.findMany({
    where: {
      ...NOT_VOIDED,
      OR: [{ pickupDate: { gte, lt } }, { dropoffDate: { gte, lt } }],
      ...(clientId ? { property: { clientId } } : {}),
    },
    select: { id: true, pickupDate: true, dropoffDate: true, noPickupRequired: true, status: true, property: { select: { name: true } } },
    orderBy: [{ pickupDate: "asc" }, { id: "asc" }],
  });
  const counts: Record<string, CalendarLaundryDay> = {};
  for (const day of listDays(range.start, range.end)) counts[day] = { pickups: 0, drops: 0, items: [] };
  for (const task of tasks) {
    const pickupDay = utcDateToDayKey(task.pickupDate);
    const dropDay = utcDateToDayKey(task.dropoffDate);
    // No pickup takes place when none is required or the pickup was skipped.
    const propertyName = task.property?.name?.trim() || "Laundry";
    const status = String(task.status);
    if (counts[pickupDay] && !task.noPickupRequired && task.status !== "SKIPPED_PICKUP") {
      counts[pickupDay].pickups += 1;
      counts[pickupDay].items.push({ id: `${task.id}-pickup`, kind: "pickup", propertyName, status });
    }
    if (counts[dropDay]) {
      counts[dropDay].drops += 1;
      counts[dropDay].items.push({ id: `${task.id}-drop`, kind: "drop", propertyName, status });
    }
  }
  return counts;
}

async function loadCleanerSources(jobs: CalendarJob[]): Promise<RowSource[]> {
  const active = await db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: { id: true, name: true, email: true },
  });
  const sources = new Map<string, RowSource>();
  for (const user of active) sources.set(user.id, { id: user.id, label: personName(user), active: true, unavailable: {} });
  // A cleaner with work in range keeps a row even when their account is inactive.
  for (const job of jobs) {
    for (const cleaner of job.cleaners) {
      if (!sources.has(cleaner.id)) sources.set(cleaner.id, { id: cleaner.id, label: cleaner.name, active: false, unavailable: {} });
    }
  }
  return Array.from(sources.values());
}

/**
 * The unavailability lane: recorded leave or a day off first (its reason, e.g.
 * "On leave 12–14 Nov"), else a day outside the saved roster ("Not available
 * on Mondays").
 */
async function attachRoster(sources: RowSource[], days: string[]): Promise<void> {
  const ids = sources.map((source) => source.id);
  const [profiles, leave] = await Promise.all([
    listCleanerAvailabilities(ids),
    days.length ? loadLeaveForUsers(ids, days[0], days[days.length - 1]) : Promise.resolve(new Map<string, LeaveEntry[]>()),
  ]);
  const byId = new Map(profiles.map((profile) => [profile.userId, profile]));
  for (const source of sources) {
    const entries = leave.get(source.id) ?? [];
    for (const day of days) {
      const entry = leaveOnDay(entries, day);
      if (entry) source.unavailable[day] = leaveReason(entry);
    }
    const profile = byId.get(source.id);
    if (!profile) continue;
    const availability = { mode: profile.mode, weekly: profile.weekly, dateOverrides: profile.dateOverrides };
    for (const day of days) {
      if (source.unavailable[day]) continue;
      const blocker = dayAvailabilityBlocker(day, availability);
      if (blocker) source.unavailable[day] = blocker.reason;
    }
  }
}

export async function loadCalendarRange(range: CalendarRange, filters: CalendarFilters, now: Date = new Date()): Promise<CalendarResponse> {
  const days = listDays(range.start, range.end);
  const records = await loadJobRecords(range);
  const truncated = records.length > CALENDAR_JOB_LIMIT;
  // Drafts are not scheduled work: excluded as the Command page excludes them.
  const withCancelled = records
    .slice(0, CALENDAR_JOB_LIMIT)
    .filter((record) => !parseJobInternalNotes(record.internalNotes).isDraft)
    .map((record) => toCalendarJob(record, now));
  // Cancelled jobs are not work: left out of every lane, hour total and count,
  // and shown only when the Status filter asks for them ("Cancelled").
  const allJobs = withCancelled.filter((job) => job.status !== "CANCELLED");
  const showCancelled = Boolean(filters.statuses?.includes("CANCELLED" as JobStatus));
  const jobs = (showCancelled ? withCancelled : allJobs).filter((job) => matchesCalendarFilters(job, filters));
  // Counts for the Status filter's options: the client filter applies, the status and cleaner filters do not.
  const forCounts = allJobs.filter((job) => matchesCalendarFilters(job, { ...filters, statuses: null, unassignedOnly: false }));
  const statusCounts: Record<string, number> = {};
  for (const job of forCounts) statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
  const cancelledCount = withCancelled.filter((job) => job.status === "CANCELLED" && matchesCalendarFilters(job, { ...filters, statuses: null, unassignedOnly: false })).length;
  if (cancelledCount > 0) statusCounts.CANCELLED = cancelledCount;

  const cleanerSources = await loadCleanerSources(allJobs);
  await attachRoster(cleanerSources, days);
  const propertySources: RowSource[] = filters.rowsMode === "properties"
    ? Array.from(new Map(jobs.map((job) => [job.propertyId, { id: job.propertyId, label: job.propertyName, active: true, unavailable: {} }])).values())
    : [];

  return {
    range: { start: range.start, end: range.end, days },
    today: sydneyTodayKey(now),
    generatedAt: now.toISOString(),
    rowsMode: filters.rowsMode,
    // Hours are the whole workload in range (all jobs, not only the filtered ones).
    cleanerRows: buildRows(cleanerSources, allJobs, "cleaner"),
    propertyRows: buildRows(propertySources, allJobs, "property"),
    jobs,
    laundry: filters.includeLaundry ? await loadLaundryCounts(range, filters.clientId) : null,
    summary: {
      jobs: jobs.length,
      withoutCleaner: jobs.filter((job) => chipCategory(job) === "unassigned").length,
      skipped: jobs.filter((job) => job.skipped).length,
      statusCounts,
      unassignedTotal: forCounts.filter((job) => chipCategory(job) === "unassigned").length,
    },
    hoursBasis: HOURS_BASIS,
    truncated,
  };
}
