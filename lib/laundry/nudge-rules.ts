/**
 * Which on-demand laundry nudges a run offers, read from the Pipeline's own
 * exception rules (./pipeline.ts) and the run's handoff state. PURE.
 *
 * - "Ask cleaner": the run is not picked up yet and the pickup is in doubt —
 *   the latest handoff says NOT_READY, the pickup is overdue, or the cleaner
 *   has not confirmed the bags although the pickup day has come and the clean
 *   is no longer in progress.
 * - "Request photo": the run carries NO_DROP_PHOTO (delivered without the
 *   drop-off photo the settings require). The Pipeline has no "missing pickup
 *   photo" exception, so nothing else asks for a photo.
 *
 * Both go to the cleaner(s) assigned to the run's job through the existing
 * laundry nudge route, which also enforces the cool-down below per run and
 * kind on the server (lib/notifications/office-actions.ts).
 * "Chase supplier" is separate (./supplier-chase-rules.ts): it goes to the
 * supplier's stored contact, not to a cleaner.
 */
import { dayKeyOf, type PipelineException } from "./pipeline";

export type LaundryNudgeKind = "ASK_CLEANER" | "REQUEST_PHOTO";

export const NUDGE_COOL_DOWN_MINUTES = 30;

export const NUDGE_LABELS: Record<LaundryNudgeKind, { button: string; title: string; text: string }> = {
  ASK_CLEANER: {
    button: "Ask cleaner",
    title: "Ask the cleaner about the laundry",
    text: "The office needs an update from you about the laundry for this job.",
  },
  REQUEST_PHOTO: {
    button: "Request photo",
    title: "Request a laundry photo",
    text: "The office asks for a photo of the laundry for this job.",
  },
};

export type NudgeRunFacts = {
  status: string;
  pickupDate: Date | string | null | undefined;
  exceptions: PipelineException[];
  /** Latest handoff readiness: true ready, false not ready, null not confirmed. */
  readiness: boolean | null;
  jobStatus?: string | null;
  hasJob: boolean;
};

const NOT_PICKED_UP = new Set(["PENDING", "CONFIRMED", "FLAGGED"]);

export function laundryNudgeKinds(run: NudgeRunFacts, todayKey: string): LaundryNudgeKind[] {
  if (!run.hasJob) return [];
  const codes = new Set(run.exceptions.map((item) => item.code));
  const kinds: LaundryNudgeKind[] = [];
  if (NOT_PICKED_UP.has(run.status)) {
    const pickupKey = dayKeyOf(run.pickupDate ?? null);
    const pickupDue = pickupKey !== null && pickupKey <= todayKey;
    const unconfirmed = run.readiness === null && pickupDue && run.jobStatus !== "IN_PROGRESS";
    if (codes.has("NOT_READY") || codes.has("PICKUP_OVERDUE") || unconfirmed) kinds.push("ASK_CLEANER");
  }
  if (codes.has("NO_DROP_PHOTO")) kinds.push("REQUEST_PHOTO");
  return kinds;
}

/**
 * The idempotency key for a nudge: the same run, kind and cool-down window
 * give the same key, so a double click or a retry after "no answer" is one
 * request, and the server's cool-down answers anything else in the window.
 */
export function nudgeIdempotencyKey(taskId: string, kind: LaundryNudgeKind, nowMs: number): string {
  const windowIndex = Math.floor(nowMs / (NUDGE_COOL_DOWN_MINUTES * 60_000));
  return `nudge:${taskId}:${kind}:${windowIndex}`.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
}
