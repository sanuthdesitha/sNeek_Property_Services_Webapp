/**
 * The pure half of moving laundry runs (no database): the date-only format the
 * edit dialog writes and the plan for what moves. See lib/laundry/reschedule.ts.
 */
import { addDaysToKey } from "@/lib/time/sydney-range";
import { dayKeyOf, daysBetweenKeys } from "@/lib/laundry/pipeline";

export type ReschedulePlanInput = {
  status: string;
  pickupDate: Date | string;
  dropoffDate: Date | string;
  pickedUpAt?: Date | string | null;
};

export type ReschedulePlan =
  | { ok: true; pickupKey: string; dropoffKey: string; movesPickup: boolean }
  | { ok: false; reason: string };

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function dateOnlyIso(key: string): string {
  return `${key}T00:00:00.000Z`;
}

export function planReschedule(task: ReschedulePlanInput, toKey: string): ReschedulePlan {
  if (!DAY_KEY.test(toKey)) return { ok: false, reason: "Choose a valid day." };
  const pickupKey = dayKeyOf(task.pickupDate);
  const dropKey = dayKeyOf(task.dropoffDate);
  if (!pickupKey || !dropKey) return { ok: false, reason: "This run has no valid pickup or drop-off date." };
  if (task.status === "DROPPED" || task.status === "SKIPPED_PICKUP") {
    return { ok: false, reason: "Already delivered or skipped; there is nothing to move." };
  }
  // Picked up or "Ready to return": only the drop-off moves.
  if (task.status === "PICKED_UP" || task.status === "READY_TO_RETURN") {
    const pickedKey = dayKeyOf(task.pickedUpAt) ?? pickupKey;
    if (toKey < pickedKey) return { ok: false, reason: "The drop-off cannot be before the pickup." };
    return { ok: true, pickupKey, dropoffKey: toKey, movesPickup: false };
  }
  const gap = Math.max(0, daysBetweenKeys(pickupKey, dropKey));
  return { ok: true, pickupKey: toKey, dropoffKey: addDaysToKey(toKey, gap), movesPickup: true };
}

