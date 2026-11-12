import "server-only";
/**
 * The cancel / restore flows the routes call: the transactional service
 * (./cancel), then the inbox notice after commit, and the restore slot check
 * (leave, clashes, roster, the day having passed) that needs the explicit
 * override the assign route uses.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadLeaveForUsers } from "@/lib/accounts/leave";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { rankCleanerSuggestions, type SuggestionCandidate } from "@/lib/jobs/cleaner-suggestions";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import { cancelJob, releasedAssignmentsFor, restoreJob, type CancelActor, type CancelResult, type RestoreResult } from "./cancel";
import { sendJobCancelledNotice, sendJobRestoredNotice, type CancelNoticeOutcome } from "./cancel-notice";

const DAY_FORMAT = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function dayLabel(date: Date): string {
  return DAY_FORMAT.format(date);
}

export type CancelFlowResult = CancelResult & { notices: CancelNoticeOutcome[]; noticeError: string | null };

export async function cancelJobAndNotify(jobId: string, input: { reason: string; expectedUpdatedAt?: string; notify?: boolean }, actor: CancelActor): Promise<CancelFlowResult> {
  const result = await cancelJob(jobId, input, actor);
  const recipients = result.released
    .filter((row) => row.isActive)
    .map((row) => ({ id: row.userId, role: row.role as Role, name: row.name, email: row.email }));
  if (input.notify === false || recipients.length === 0) return { ...result, notices: [], noticeError: null };
  try {
    const notices = await sendJobCancelledNotice({
      job: { id: result.jobId, jobNumber: result.jobNumber, propertyName: result.propertyName, dayLabel: dayLabel(result.scheduledDate) },
      reason: input.reason.trim(),
      actorId: actor.id,
      recipients,
      cancelledAtIso: result.cancelledAt.toISOString(),
    });
    return { ...result, notices, noticeError: null };
  } catch {
    // The cancel is committed; the notice failing is reported, never hidden.
    return { ...result, notices: [], noticeError: "The job is cancelled, but the cleaner notice could not be queued. Tell them directly." };
  }
}

export type RestoreConflict = { userId: string | null; name: string | null; reason: string };

/** What would stop a restore "still passing the slot rules" — each needs the explicit override. */
export async function restoreSlotConflicts(jobId: string, now: Date = new Date()): Promise<RestoreConflict[]> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, scheduledDate: true, startTime: true, endTime: true, dueTime: true, estimatedHours: true },
  });
  if (!job) return [];
  const dayKey = job.scheduledDate.toISOString().slice(0, 10);
  const conflicts: RestoreConflict[] = [];
  if (dayKey < sydneyTodayKey(now)) conflicts.push({ userId: null, name: null, reason: "The job's day has already passed." });
  const released = await releasedAssignmentsFor(db, jobId);
  const ids = released.map((row) => row.userId);
  if (ids.length === 0) return conflicts;
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
  const nextDay = new Date(dayStart.getTime() + 86_400_000);
  const [people, profiles, leave, sameDay] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    listCleanerAvailabilities(ids),
    loadLeaveForUsers(ids, dayKey, dayKey),
    db.jobAssignment.findMany({
      where: { removedAt: null, userId: { in: ids }, job: { id: { not: jobId }, scheduledDate: { gte: dayStart, lt: nextDay }, cleanSkipStatus: { not: "SKIPPED" } } },
      select: { userId: true, job: { select: { id: true, startTime: true, endTime: true, dueTime: true, estimatedHours: true, property: { select: { name: true } } } } },
    }),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.userId, profile]));
  for (const person of people) {
    const profile = profileById.get(person.id);
    const name = person.name?.trim() || person.email || "Cleaner";
    const candidate: SuggestionCandidate = {
      id: person.id,
      name,
      availability: profile ? { mode: profile.mode, weekly: profile.weekly, dateOverrides: profile.dateOverrides } : null,
      otherJobsThatDay: sameDay.filter((row) => row.userId === person.id).map((row) => ({
        jobId: row.job.id, propertyName: row.job.property?.name ?? "another property",
        startTime: row.job.startTime, endTime: row.job.endTime, dueTime: row.job.dueTime, estimatedHours: row.job.estimatedHours,
      })),
      priorCleansHere: 0,
      leave: leave.get(person.id) ?? [],
    };
    const [verdict] = rankCleanerSuggestions(
      { id: job.id, dayKey, startTime: job.startTime, endTime: job.endTime, dueTime: job.dueTime, estimatedHours: job.estimatedHours },
      [candidate],
      { limit: 1, blockedLimit: 1 },
    );
    if (verdict?.blocker) conflicts.push({ userId: person.id, name, reason: verdict.blocker.reason });
  }
  return conflicts;
}

export type RestoreFlowResult = RestoreResult & { notices: CancelNoticeOutcome[]; noticeError: string | null };

export async function restoreJobAndNotify(jobId: string, actor: CancelActor, options: { skipUserIds?: string[]; expectedUpdatedAt?: string }): Promise<RestoreFlowResult> {
  const result = await restoreJob(jobId, actor, options);
  if (result.restoredUserIds.length === 0) return { ...result, notices: [], noticeError: null };
  const people = await db.user.findMany({ where: { id: { in: result.restoredUserIds }, isActive: true }, select: { id: true, role: true, name: true, email: true } });
  try {
    const notices = await sendJobRestoredNotice({
      job: { id: result.jobId, jobNumber: result.jobNumber, propertyName: result.propertyName, dayLabel: dayLabel(result.scheduledDate) },
      actorId: actor.id,
      recipients: people,
      restoredAtIso: new Date().toISOString(),
    });
    return { ...result, notices, noticeError: null };
  } catch {
    return { ...result, notices: [], noticeError: "The job is restored, but the cleaner notice could not be queued. Tell them directly." };
  }
}
