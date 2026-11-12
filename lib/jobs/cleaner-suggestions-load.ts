import "server-only";
import { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { loadLeaveForUsers } from "@/lib/accounts/leave";
import { rankCleanerSuggestions, type CleanerSuggestion, type SuggestionCandidate, type SuggestionOtherJob } from "./cleaner-suggestions";
import { loadSuggestionQaScores } from "./cleaner-suggestions-qa";
import { isGeoPoint, type GeoPoint } from "./cleaner-suggestions-signals";

export type CleanerSuggestionsResult =
  | { kind: "not_found" }
  | { kind: "assigned"; reason: string }
  | { kind: "ok"; jobId: string; suggestions: CleanerSuggestion[]; considered: number };

const FINISHED: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];

function toPoint(row: { latitude: number | null; longitude: number | null } | null | undefined): GeoPoint | null {
  const point = row ? { lat: row.latitude, lng: row.longitude } : null;
  return isGeoPoint(point) ? point : null;
}

/**
 * Reads the facts `rankCleanerSuggestions` needs for one job. Suggestions are
 * only offered while nobody is on the job: the quick-assign route replaces the
 * assignment list, so suggesting for a staffed job would invite replacing
 * whoever is already there.
 */
export async function loadCleanerSuggestions(jobId: string): Promise<CleanerSuggestionsResult> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true, propertyId: true, scheduledDate: true, startTime: true, endTime: true, dueTime: true,
      estimatedHours: true, status: true, cleanSkipStatus: true,
      property: { select: { latitude: true, longitude: true } },
      assignments: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!job) return { kind: "not_found" };
  if (job.assignments.length > 0) return { kind: "assigned", reason: "This job already has a cleaner. Change people on the job's People tab." };
  if (job.cleanSkipStatus === "SKIPPED") return { kind: "assigned", reason: "This clean is skipped." };

  const dayKey = job.scheduledDate.toISOString().slice(0, 10);
  const dayStart = new Date(`${dayKey}T00:00:00.000Z`);
  const nextDay = new Date(dayStart.getTime() + 86_400_000);

  const cleaners = await db.user.findMany({
    where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) },
    select: { id: true, name: true, email: true, latitude: true, longitude: true },
  });
  const ids = cleaners.map((cleaner) => cleaner.id);
  if (ids.length === 0) return { kind: "ok", jobId, suggestions: [], considered: 0 };

  const [profiles, sameDay, history, qaScores, leave] = await Promise.all([
    listCleanerAvailabilities(ids),
    db.jobAssignment.findMany({
      where: {
        removedAt: null,
        userId: { in: ids },
        job: { id: { not: jobId }, scheduledDate: { gte: dayStart, lt: nextDay }, cleanSkipStatus: { not: "SKIPPED" } },
      },
      select: {
        userId: true,
        job: { select: { id: true, startTime: true, endTime: true, dueTime: true, estimatedHours: true, property: { select: { name: true, latitude: true, longitude: true } } } },
      },
    }),
    db.jobAssignment.groupBy({
      by: ["userId"],
      where: { removedAt: null, userId: { in: ids }, job: { propertyId: job.propertyId, status: { in: FINISHED }, id: { not: jobId } } },
      _count: { _all: true },
    }),
    loadSuggestionQaScores(ids),
    loadLeaveForUsers(ids, dayKey, dayKey),
  ]);

  const profileById = new Map(profiles.map((profile) => [profile.userId, profile]));
  const historyById = new Map(history.map((row) => [row.userId, row._count._all]));
  const othersById = new Map<string, SuggestionOtherJob[]>();
  for (const row of sameDay) {
    const list = othersById.get(row.userId) ?? [];
    list.push({
      jobId: row.job.id,
      propertyName: row.job.property?.name ?? "another property",
      startTime: row.job.startTime,
      endTime: row.job.endTime,
      dueTime: row.job.dueTime,
      estimatedHours: row.job.estimatedHours,
      location: toPoint(row.job.property),
    });
    othersById.set(row.userId, list);
  }

  const candidates: SuggestionCandidate[] = cleaners.map((cleaner) => {
    const profile = profileById.get(cleaner.id);
    return {
      id: cleaner.id,
      name: cleaner.name?.trim() || cleaner.email || "Cleaner",
      availability: profile ? { mode: profile.mode, weekly: profile.weekly, dateOverrides: profile.dateOverrides } : null,
      otherJobsThatDay: othersById.get(cleaner.id) ?? [],
      priorCleansHere: historyById.get(cleaner.id) ?? 0,
      home: toPoint(cleaner),
      qa: qaScores.get(cleaner.id) ?? null,
      leave: leave.get(cleaner.id) ?? [],
    };
  });

  const suggestions = rankCleanerSuggestions(
    {
      id: job.id, dayKey, startTime: job.startTime, endTime: job.endTime, dueTime: job.dueTime, estimatedHours: job.estimatedHours,
      location: toPoint(job.property),
    },
    candidates,
  );
  return { kind: "ok", jobId, suggestions, considered: candidates.length };
}
