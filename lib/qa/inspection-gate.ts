/**
 * May this inspection start, and does starting it owe the cleaner a nudge?
 *
 * QA could previously pick up any job, including one the cleaner had not
 * finished — the pickup route ran no readiness check at all. The rule the owner
 * asked for is not "block it": inspectors have real reasons to walk in early (a
 * guest checking in, a cleaner who has left site without filing). So an
 * unsubmitted job is allowed through *with a stated reason*, and that reason
 * triggers a push telling the cleaner to complete their form.
 *
 * Readiness itself is not redefined here — `deriveReadiness` in ./progress is
 * the single definition of "gradable" shared by the QA queue and progress
 * routes, and this composes with it.
 *
 * Note: "early start" here means QA inspecting before submission. It is
 * unrelated to the cleaner-side early job start (`earlyStart*` on the GPS
 * check-in route), which is a different feature.
 *
 * PURE: no DB, no clock. The route stays a thin adapter.
 */

import { deriveReadiness } from "./progress";

/** Free text, but long enough to be an actual explanation rather than ".". */
export const MIN_INSPECTION_REASON_LENGTH = 10;
export const MAX_INSPECTION_REASON_LENGTH = 500;

export type InspectionStartDecision =
  | { outcome: "ALLOWED"; earlyStartReason: null; shouldPushCleaner: false }
  | { outcome: "ALLOWED_EARLY"; earlyStartReason: string; shouldPushCleaner: true }
  | { outcome: "REASON_REQUIRED"; message: string };

export function normalizeInspectionReason(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_INSPECTION_REASON_LENGTH) : "";
}

/**
 * @param job    what we know about the cleaner's progress
 * @param reason the inspector's stated justification, if they gave one
 */
export function decideInspectionStart(
  job: { status?: string | null; hasSubmission?: boolean | null; isRework?: boolean | null },
  reason?: unknown
): InspectionStartDecision {
  const readiness = deriveReadiness(job);
  if (readiness === "READY") {
    // Normal path: the cleaner is done. A reason would be noise, so drop it.
    return { outcome: "ALLOWED", earlyStartReason: null, shouldPushCleaner: false };
  }

  const trimmed = normalizeInspectionReason(reason);
  if (trimmed.length < MIN_INSPECTION_REASON_LENGTH) {
    return {
      outcome: "REASON_REQUIRED",
      message:
        readiness === "REWORK_PENDING"
          ? "This rework has not been re-submitted yet. Add a reason (at least 10 characters) to inspect it anyway."
          : "The cleaner has not submitted their form yet. Add a reason (at least 10 characters) to inspect it anyway.",
    };
  }

  return { outcome: "ALLOWED_EARLY", earlyStartReason: trimmed, shouldPushCleaner: true };
}
