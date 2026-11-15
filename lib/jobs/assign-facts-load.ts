import "server-only";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { loadLeaveForUsers } from "@/lib/accounts/leave";
import { leaveOnDay, leaveReason } from "@/lib/accounts/leave-rules";
import { assignmentDocumentWarnings } from "@/lib/workforce/assignment-document-warnings";
import type { AssignFactWarning, AssignFactsResponse } from "./assign-facts-types";

const DAY_MS = 86_400_000;

/**
 * Leave, expired police check / visa and other work that day for every active
 * cleaner, for the jobs the assign dialog is about. READ ONLY, and built from
 * the same helpers the assign and bulk-assign routes use for their 409, so
 * the dialog can show the warning before Save instead of after.
 */
export async function loadAssignFacts(jobIds: readonly string[]): Promise<AssignFactsResponse | null> {
  const ids = Array.from(new Set(jobIds.filter(Boolean)));
  const jobs = await db.job.findMany({ where: { id: { in: ids } }, select: { id: true, scheduledDate: true } });
  if (jobs.length !== ids.length) return null;
  const cleaners = await db.user.findMany({ where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) }, select: { id: true } });
  const cleanerIds = cleaners.map((cleaner) => cleaner.id);
  const dayKeys = jobs.map((job) => job.scheduledDate.toISOString().slice(0, 10));
  const sorted = [...dayKeys].sort();
  const leave = await loadLeaveForUsers(cleanerIds, sorted[0] ?? "", sorted[sorted.length - 1] ?? "");

  const warnings = new Map<string, AssignFactWarning[]>();
  const push = (userId: string, warning: AssignFactWarning) => warnings.set(userId, [...(warnings.get(userId) ?? []), warning]);
  // Documents are read once per distinct day, not once per job.
  const documentsByDay = new Map<string, Awaited<ReturnType<typeof assignmentDocumentWarnings>>>();
  for (const job of jobs) {
    const dayKey = job.scheduledDate.toISOString().slice(0, 10);
    for (const userId of cleanerIds) {
      const entry = leaveOnDay(leave.get(userId) ?? [], dayKey);
      if (entry) push(userId, { kind: "leave", jobId: job.id, text: leaveReason(entry) });
    }
    if (!documentsByDay.has(dayKey)) documentsByDay.set(dayKey, await assignmentDocumentWarnings(cleanerIds, job.scheduledDate));
    for (const row of documentsByDay.get(dayKey) ?? []) {
      push(row.userId, { kind: row.kind === "VISA" ? "visa" : "police_check", jobId: job.id, text: row.reason });
    }
  }

  const otherJobs = new Map<string, number>();
  if (jobs.length === 1) {
    const dayStart = new Date(`${dayKeys[0]}T00:00:00.000Z`);
    const rows = await db.jobAssignment.groupBy({
      by: ["userId"],
      where: {
        removedAt: null,
        userId: { in: cleanerIds },
        job: { id: { not: jobs[0].id }, scheduledDate: { gte: dayStart, lt: new Date(dayStart.getTime() + DAY_MS) }, status: { not: "CANCELLED" }, cleanSkipStatus: { not: "SKIPPED" } },
      },
      _count: { _all: true },
    });
    for (const row of rows) otherJobs.set(row.userId, row._count._all);
  }

  return {
    jobs: jobs.map((job) => ({ id: job.id, dayKey: job.scheduledDate.toISOString().slice(0, 10) })),
    cleaners: cleanerIds.map((userId) => ({
      userId,
      otherJobsThatDay: jobs.length === 1 ? otherJobs.get(userId) ?? 0 : null,
      warnings: warnings.get(userId) ?? [],
    })),
  };
}
