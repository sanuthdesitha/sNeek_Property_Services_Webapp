/**
 * Laundry portal Tracking (board 3): sets grouped by where they are, "Day n
 * of m" at the laundry, and the issues under them. PURE and PLAIN.
 *
 * Stages come from the stored status and days only:
 *   pickup  PENDING / CONFIRMED / FLAGGED
 *   laundry PICKED_UP, drop-off day still ahead
 *   drop    PICKED_UP, drop-off day reached
 *   done    DROPPED
 * There is no "Ready to return" stage: nothing stored says a set is ready
 * before it is dropped (weight or price can be added at the drop), so it is
 * not derived or shown.
 */
import { dayKeyOf, daysBetweenKeys } from "./pipeline";

export type TrackingStage = "pickup" | "laundry" | "drop" | "done";

export const TRACKING_STAGES: ReadonlyArray<{ id: TrackingStage; label: string }> = [
  { id: "pickup", label: "To pick up" },
  { id: "laundry", label: "At laundry" },
  { id: "drop", label: "To drop" },
  { id: "done", label: "Done" },
];

type StageTask = { status: string; pickupDate: string | Date; dropoffDate: string | Date; pickedUpAt?: string | Date | null };

export function trackingStage(task: StageTask, todayKey: string): TrackingStage | null {
  if (["PENDING", "CONFIRMED", "FLAGGED"].includes(task.status)) return "pickup";
  if (task.status === "PICKED_UP") {
    const dropKey = dayKeyOf(task.dropoffDate);
    return dropKey !== null && dropKey <= todayKey ? "drop" : "laundry";
  }
  if (task.status === "DROPPED") return "done";
  return null;
}

/** "Day 3 of 2" for a set at the laundry: days since pickup (inclusive) against the planned days. */
export function trackingDayOf(task: StageTask, todayKey: string): { day: number; planned: number } | null {
  if (task.status !== "PICKED_UP") return null;
  const pickedKey = dayKeyOf(task.pickedUpAt ?? null) ?? dayKeyOf(task.pickupDate);
  const dropKey = dayKeyOf(task.dropoffDate);
  if (!pickedKey || !dropKey) return null;
  return { day: daysBetweenKeys(pickedKey, todayKey) + 1, planned: Math.max(1, daysBetweenKeys(pickedKey, dropKey)) };
}

export function stageCounts(tasks: readonly StageTask[], todayKey: string): Record<TrackingStage, number> {
  const counts: Record<TrackingStage, number> = { pickup: 0, laundry: 0, drop: 0, done: 0 };
  for (const task of tasks) {
    const stage = trackingStage(task, todayKey);
    if (stage) counts[stage] += 1;
  }
  return counts;
}

export type FailedPickupIssue = { taskId: string; propertyName: string; atIso: string; reason: string; rescheduledTo: string | null; awaitingOffice: boolean };

type IssueTask = { id: string; property?: { name?: string | null } | null; confirmations?: Array<{ notes?: string | null; createdAt?: string | Date }> };

/** Failed pickups recorded in the last `days` days (reschedules and approval requests). */
export function failedPickupIssues(tasks: readonly IssueTask[], now: Date, days = 7): FailedPickupIssue[] {
  const since = now.getTime() - days * 86_400_000;
  const out: FailedPickupIssue[] = [];
  for (const task of tasks) {
    for (const row of task.confirmations ?? []) {
      let meta: { event?: unknown; reason?: unknown; rescheduledPickupDate?: unknown; approvalStatus?: unknown } | null = null;
      try {
        meta = JSON.parse(row.notes ?? "null");
      } catch {
        meta = null;
      }
      if (!meta || (meta.event !== "FAILED_PICKUP_RESCHEDULE" && meta.event !== "FAILED_PICKUP_REQUEST")) continue;
      const at = row.createdAt ? new Date(row.createdAt) : null;
      if (!at || Number.isNaN(at.getTime()) || at.getTime() < since) continue;
      out.push({
        taskId: task.id,
        propertyName: task.property?.name ?? "Property",
        atIso: at.toISOString(),
        reason: typeof meta.reason === "string" ? meta.reason : "No reason recorded",
        rescheduledTo: typeof meta.rescheduledPickupDate === "string" ? meta.rescheduledPickupDate.slice(0, 10) : null,
        awaitingOffice: meta.event === "FAILED_PICKUP_REQUEST" && meta.approvalStatus === "PENDING",
      });
    }
  }
  return out.sort((a, b) => b.atIso.localeCompare(a.atIso));
}
