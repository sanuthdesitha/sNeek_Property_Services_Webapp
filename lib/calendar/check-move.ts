import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { rankCleanerSuggestions, type SuggestionCandidate, type SuggestionJob } from "@/lib/jobs/cleaner-suggestions";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { rescheduleWindowError } from "@/lib/phase4/analytics";
import { addDaysToKey } from "@/lib/time/sydney-range";
import { calendarMoveBlock } from "./move-rules";
import { dayKeyToUtcDate, isDayKey, mediumDayLabel, utcDateToDayKey } from "./range";
import type { CheckMoveRequest, CheckMoveResponse, MoveWarning } from "./types";

/**
 * Read-only check before a calendar move. Nothing is written here.
 *
 * It answers, from existing logic only:
 * - refusals: the calendar's move rule (`calendarMoveBlock`), the reschedule
 *   service's start/finish check (`rescheduleWindowError`), and the assign
 *   route's own refusals (inactive or non-cleaner account, draft, skipped);
 * - warnings: clashes with the cleaner's other jobs that day and days outside
 *   their saved roster (`rankCleanerSuggestions`, the same verdicts the
 *   suggestions panel shows), what happens to a booking-driven turnover, and
 *   which notices the existing services send;
 * - the plan: the exact reschedule and assign calls the page then makes.
 */
export type CheckMoveResult = { kind: "not_found" } | { kind: "invalid"; message: string } | { kind: "ok"; result: CheckMoveResponse };

type AssignmentRow = { userId: string; isPrimary: boolean; user: { name: string | null; email: string | null } };

function personName(user: { name: string | null; email: string | null }): string {
  return user.name?.trim() || user.email?.trim() || "Cleaner";
}

/** The assignment after replacing `from` (or adding to an empty job) with `to`. */
export function plannedAssignment(current: AssignmentRow[], fromId: string | null, toId: string): { userIds: string[]; primaryUserId: string } {
  const remaining = current.filter((row) => row.userId !== fromId);
  const currentPrimary = current.find((row) => row.isPrimary)?.userId ?? current[0]?.userId ?? null;
  const primaryMoves = currentPrimary === null || currentPrimary === fromId;
  const userIds = [...remaining.map((row) => row.userId), toId];
  return { userIds, primaryUserId: primaryMoves ? toId : currentPrimary };
}

async function rosterAndClashWarnings(job: SuggestionJob & { propertyId: string }, cleanerIds: string[], names: Map<string, string>): Promise<MoveWarning[]> {
  if (cleanerIds.length === 0) return [];
  const dayStart = dayKeyToUtcDate(job.dayKey);
  const nextDay = dayKeyToUtcDate(addDaysToKey(job.dayKey, 1));
  const [profiles, sameDay] = await Promise.all([
    listCleanerAvailabilities(cleanerIds),
    db.jobAssignment.findMany({
      where: {
        removedAt: null,
        userId: { in: cleanerIds },
        job: { id: { not: job.id }, scheduledDate: { gte: dayStart, lt: nextDay }, cleanSkipStatus: { not: "SKIPPED" } },
      },
      select: { userId: true, job: { select: { id: true, startTime: true, endTime: true, dueTime: true, estimatedHours: true, property: { select: { name: true } } } } },
    }),
  ]);
  const profileById = new Map(profiles.map((profile) => [profile.userId, profile]));
  const warnings: MoveWarning[] = [];
  for (const cleanerId of cleanerIds) {
    const profile = profileById.get(cleanerId);
    const candidate: SuggestionCandidate = {
      id: cleanerId,
      name: names.get(cleanerId) ?? "Cleaner",
      availability: profile ? { mode: profile.mode, weekly: profile.weekly, dateOverrides: profile.dateOverrides } : null,
      otherJobsThatDay: sameDay.filter((row) => row.userId === cleanerId).map((row) => ({
        jobId: row.job.id,
        propertyName: row.job.property?.name ?? "another property",
        startTime: row.job.startTime,
        endTime: row.job.endTime,
        dueTime: row.job.dueTime,
        estimatedHours: row.job.estimatedHours,
      })),
      priorCleansHere: 0,
    };
    const [verdict] = rankCleanerSuggestions(job, [candidate], { limit: 1, blockedLimit: 1 });
    const name = candidate.name;
    if (verdict?.blocker) {
      warnings.push({ kind: verdict.blocker.kind, text: `${name}: ${verdict.blocker.reason}` });
    }
    for (const reason of verdict?.reasons ?? []) {
      if (reason.startsWith("Also booked at")) warnings.push({ kind: "clash", text: `${name}: ${reason}` });
    }
  }
  return warnings;
}

export async function checkCalendarMove(input: CheckMoveRequest): Promise<CheckMoveResult> {
  if (!isDayKey(input.toDate)) return { kind: "invalid", message: "Choose a date written as YYYY-MM-DD." };
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true, status: true, jobType: true, scheduledDate: true, startTime: true, endTime: true, dueTime: true,
      estimatedHours: true, cleanSkipStatus: true, internalNotes: true, reservationId: true, updatedAt: true, propertyId: true,
      property: { select: { name: true } },
      assignments: { where: { removedAt: null }, orderBy: { isPrimary: "desc" }, select: { userId: true, isPrimary: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!job) return { kind: "not_found" };

  const fromDate = utcDateToDayKey(job.scheduledDate);
  const toDate = input.toDate;
  const dateChanges = toDate !== fromDate;
  const fromCleanerId = input.fromCleanerId ?? null;
  const toCleanerId = input.toCleanerId && input.toCleanerId !== fromCleanerId ? input.toCleanerId : null;
  const meta = parseJobInternalNotes(job.internalNotes);
  const blockers: string[] = [];
  const names = new Map(job.assignments.map((row) => [row.userId, personName(row.user)]));

  const rule = calendarMoveBlock({ status: String(job.status), skipped: job.cleanSkipStatus === "SKIPPED", isDraft: meta.isDraft });
  if (rule) blockers.push(rule);
  if (!dateChanges && !toCleanerId) blockers.push("Nothing would change: the job is already on that day with those cleaners.");
  if (dateChanges) {
    const windowError = rescheduleWindowError(job.startTime, job.dueTime);
    if (windowError) blockers.push(`${windowError} Fix the job's times on its Schedule tab first.`);
  }

  let assign: CheckMoveResponse["plan"]["assign"] = null;
  if (toCleanerId) {
    const target = await db.user.findFirst({
      where: { id: toCleanerId, isActive: true, ...holdsRoleWhere(Role.CLEANER) },
      select: { id: true, name: true, email: true },
    });
    if (!target) blockers.push("Only active cleaners can be assigned, and that account is not one.");
    else names.set(target.id, personName(target));
    if (fromCleanerId && !job.assignments.some((row) => row.userId === fromCleanerId)) {
      blockers.push("The cleaner it was dragged from is no longer on this job. Reload and try again.");
    }
    if (job.assignments.some((row) => row.userId === toCleanerId)) {
      blockers.push(`${names.get(toCleanerId) ?? "That cleaner"} is already on this job.`);
    }
    assign = plannedAssignment(job.assignments, fromCleanerId, toCleanerId);
  }

  const warnings: MoveWarning[] = [];
  if (blockers.length === 0) {
    const afterIds = assign?.userIds ?? job.assignments.map((row) => row.userId);
    // A date change affects everyone on the job; a cleaner change only the new cleaner.
    const affected = dateChanges ? afterIds : toCleanerId ? [toCleanerId] : [];
    warnings.push(...await rosterAndClashWarnings(
      { id: job.id, propertyId: job.propertyId, dayKey: toDate, startTime: job.startTime, endTime: job.endTime, dueTime: job.dueTime, estimatedHours: job.estimatedHours },
      affected,
      names,
    ));
    if (dateChanges && job.reservationId) {
      warnings.push({
        kind: "booking",
        text: `This job follows a booking whose turnover is ${mediumDayLabel(fromDate)}. After a manual move the calendar sync keeps your date: it will not move the job back or create a second job, and it stops updating this job's date and times if the booking changes.`,
      });
    }
    if (dateChanges) {
      warnings.push({ kind: "notice", text: "The reschedule notifies the assigned cleaners and sends the client's schedule-update email when that is switched on." });
    }
    if (toCleanerId) {
      warnings.push({ kind: "notice", text: "The new cleaner is offered the job by the usual assignment notices. If the primary cleaner changes, a note to the client is prepared for you to review; it is not sent automatically." });
    }
  }

  return {
    kind: "ok",
    result: {
      jobId: job.id,
      propertyName: job.property?.name?.trim() || "Unlinked property",
      fromDate,
      toDate,
      toCleanerName: toCleanerId ? names.get(toCleanerId) ?? null : null,
      blockers,
      warnings,
      plan: {
        reschedule: dateChanges ? { date: toDate, expectedUpdatedAt: job.updatedAt.toISOString() } : null,
        assign: blockers.length === 0 ? assign : null,
      },
    },
  };
}
