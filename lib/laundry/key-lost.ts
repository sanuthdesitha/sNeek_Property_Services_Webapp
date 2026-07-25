/**
 * Key-lost-mode laundry scheduling.
 *
 * Normal scheduling picks up the day AFTER a clean and drops the day BEFORE
 * the next clean, using the property's spare key. When the spare key is lost
 * (`Property.keyLostMode`), the driver can't enter alone — so BOTH pickup and
 * drop-off are scheduled ON the cleaning day itself, after the clean starts:
 * 12:30 when the job has a late checkout, otherwise 10:00.
 *
 * This module owns the key-lost branch ONLY. The normal path in
 * `computeDraftItem` (lib/laundry/planner.ts) is deliberately untouched — it
 * short-circuits into this function at the very top when keyLostMode is on.
 */
import { startOfDay } from "date-fns";
import { LaundryStatus, Prisma } from "@prisma/client";
import type { LaundryPlanDraftItem } from "@/lib/laundry/planner";
import { atTimeOnDay, hasLateCheckout, resolveKeyLostServiceTime } from "@/lib/laundry/clean-start";

/**
 * Marker embedded in the draft item's `scenario` AND `flagNotes`. flagNotes is
 * what `applyLaundryPlanDraft` persists onto the LaundryTask row, so the tag
 * survives into the week feed and the boards can badge the task even if the
 * property is later toggled back.
 */
export const KEY_LOST_TAG = "KEY_LOST";

/** True when a task's persisted flagNotes carry the key-lost marker. */
export function isKeyLostNotes(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.includes(KEY_LOST_TAG);
}

type KeyLostPlannerJob = Prisma.JobGetPayload<{ include: { property: true } }>;

/**
 * Draft item for a job at a key-lost property: pickup and drop-off are the SAME
 * timestamp on the clean day, at the key-lost service time (12:30 with a late
 * checkout, else 10:00). Unlike the normal path (which stores startOfDay
 * midnights), these carry a real wall-clock time so the runs boards show when
 * the driver should arrive.
 */
export function computeKeyLostDraftItem(job: KeyLostPlannerJob): LaundryPlanDraftItem {
  const cleanDay = startOfDay(job.scheduledDate);
  const serviceTime = resolveKeyLostServiceTime(job);
  const serviceAt = atTimeOnDay(cleanDay, serviceTime).toISOString();
  const late = hasLateCheckout(job);

  return {
    jobId: job.id,
    propertyId: job.propertyId,
    propertyName: job.property.name,
    suburb: job.property.suburb,
    cleanDate: cleanDay.toISOString(),
    pickupDate: serviceAt,
    dropoffDate: serviceAt,
    status: LaundryStatus.PENDING,
    flagReason: null,
    flagNotes: `${KEY_LOST_TAG}: spare key unavailable — pickup and drop-off both on the clean day at ${serviceTime}${
      late ? " (late checkout)" : ""
    }, after the clean starts.`,
    scenario: "KEY_LOST",
    linenBufferSets: job.property.linenBufferSets,
  };
}
