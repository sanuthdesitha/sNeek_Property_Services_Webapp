/**
 * Leave conflicts for an assignment: which of these cleaners have recorded
 * leave or a day off on the job's calendar day. Used by the assign route (and
 * restore of a cancelled job) to require the explicit override.
 */
import "server-only";
import { loadLeaveForUsers } from "./leave";
import { leaveOnDay, leaveReason } from "./leave-rules";

export type LeaveConflict = { userId: string; name: string; reason: string };

type Person = { id: string; name: string | null; email: string | null };

export async function assignmentLeaveConflicts(userIds: readonly string[], scheduledDate: Date, people: readonly Person[]): Promise<LeaveConflict[]> {
  if (userIds.length === 0) return [];
  const day = scheduledDate.toISOString().slice(0, 10);
  const leave = await loadLeaveForUsers(userIds, day, day);
  const names = new Map(people.map((person) => [person.id, person.name?.trim() || person.email || "Cleaner"]));
  const conflicts: LeaveConflict[] = [];
  for (const userId of userIds) {
    const entry = leaveOnDay(leave.get(userId) ?? [], day);
    if (entry) conflicts.push({ userId, name: names.get(userId) ?? "Cleaner", reason: leaveReason(entry) });
  }
  return conflicts;
}
