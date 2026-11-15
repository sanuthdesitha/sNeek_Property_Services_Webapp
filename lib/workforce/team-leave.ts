import "server-only";
/**
 * Loads the team leave view: active cleaners and laundry staff, their
 * recorded leave and days off in the window (StaffLeave, not removed), how
 * many of their live jobs fall inside each block, and the weekly "usually
 * unavailable" pattern from CleanerAvailability (read only here; nothing in
 * cleaner suggestions or assignment reads it).
 */
import { JobStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadLeaveForUsers } from "@/lib/accounts/leave";
import type { TeamLeaveEntry, TeamLeavePerson, WeeklyUnavailable } from "./team-leave-model";

const LIVE_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

export type TeamLeaveData = { status: "ready"; people: TeamLeavePerson[] } | { status: "failed" };

function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export async function loadTeamLeave(start: string, end: string): Promise<TeamLeaveData> {
  try {
    const staff = await db.user.findMany({
      where: { isActive: true, role: { in: [Role.CLEANER, Role.LAUNDRY] } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    });
    const ids = staff.map((person) => person.id);
    const [leave, patterns] = await Promise.all([
      loadLeaveForUsers(ids, start, end),
      db.cleanerAvailability.findMany({
        where: { userId: { in: ids }, dayOfWeek: { not: null }, isAvailable: false },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
        select: { userId: true, dayOfWeek: true, startTime: true, endTime: true, note: true },
      }),
    ]);

    const entries = Array.from(leave.values()).flat();
    const counts = await Promise.all(
      entries.map((entry) =>
        db.jobAssignment
          .count({
            where: {
              userId: entry.userId,
              removedAt: null,
              job: { status: { in: LIVE_STATUSES }, scheduledDate: { gte: dateOnly(entry.startDate), lte: dateOnly(entry.endDate) } },
            },
          })
          .catch(() => null),
      ),
    );
    const coverById = new Map(entries.map((entry, index) => [entry.id, counts[index]]));

    const people: TeamLeavePerson[] = staff.map((person) => ({
      id: person.id,
      name: person.name?.trim() || person.email,
      role: person.role,
      leave: (leave.get(person.id) ?? []).map(
        (entry): TeamLeaveEntry => ({
          id: entry.id,
          userId: entry.userId,
          kind: entry.kind,
          startDate: entry.startDate,
          endDate: entry.endDate,
          note: entry.note,
          jobsNeedingCover: coverById.get(entry.id) ?? null,
        }),
      ),
      usuallyUnavailable: patterns
        .filter((row) => row.userId === person.id && row.dayOfWeek !== null)
        .map((row): WeeklyUnavailable => ({ dayOfWeek: row.dayOfWeek as number, startTime: row.startTime, endTime: row.endTime, note: row.note })),
    }));
    return { status: "ready", people };
  } catch {
    return { status: "failed" };
  }
}
