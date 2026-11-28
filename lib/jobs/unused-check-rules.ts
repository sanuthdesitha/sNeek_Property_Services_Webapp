/**
 * "Looks unused — ask the office" (2026-11-28): the rules and words both the
 * cleaner's screen and the routes use. Plain module (no database).
 *
 * A cleaner at an Airbnb turnover that looks like nobody stayed asks the
 * office before cleaning. The office answers Clean as normal, Light refresh
 * only, or Do not clean. The answer is a record and a message: it never
 * cancels, skips, reschedules or re-prices the job, and never changes pay.
 * The office updates the job through the existing job flows.
 */
import type { JobStatus, JobType } from "@prisma/client";

export const UNUSED_CHECK_DECISIONS = ["CLEAN_AS_NORMAL", "LIGHT_REFRESH", "DO_NOT_CLEAN"] as const;
export type UnusedCheckDecision = (typeof UNUSED_CHECK_DECISIONS)[number];

export const UNUSED_CHECK_DECISION_LABELS: Record<UnusedCheckDecision, string> = {
  CLEAN_AS_NORMAL: "Clean as normal",
  LIGHT_REFRESH: "Light refresh only",
  DO_NOT_CLEAN: "Do not clean",
};

/** What the cleaner reads under the answer. */
export const UNUSED_CHECK_DECISION_GUIDANCE: Record<UnusedCheckDecision, string> = {
  CLEAN_AS_NORMAL: "Do the full turnover as usual.",
  LIGHT_REFRESH: "Do a light refresh only. Follow the office's note.",
  DO_NOT_CLEAN: "Do not clean. Wait: the office will update the job. Your job and pay are not changed by this answer.",
};

export const UNUSED_CHECK_NOTE_MAX = 2000;
export const UNUSED_CHECK_PHOTO_MAX = 6;

/** The only job type it is offered on. */
export const UNUSED_CHECK_JOB_TYPE: JobType = "AIRBNB_TURNOVER";

/** The cleaner is at the job: accepted, on the way or arrived, working or paused. */
export const UNUSED_CHECK_JOB_STATUSES: readonly JobStatus[] = ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED"];

export type UnusedCheckEligibilityInput = {
  jobType: string | null | undefined;
  jobStatus: string | null | undefined;
  /** The asking cleaner's assignment response (ACCEPTED to ask). */
  responseStatus: string | null | undefined;
};

export type UnusedCheckEligibility = { ok: true } | { ok: false; reason: string };

export function unusedCheckEligibility(input: UnusedCheckEligibilityInput): UnusedCheckEligibility {
  if (input.jobType !== UNUSED_CHECK_JOB_TYPE) {
    return { ok: false, reason: "Only Airbnb turnovers can be checked with the office this way." };
  }
  if (input.responseStatus !== "ACCEPTED") {
    return { ok: false, reason: "Accept the job before you ask the office." };
  }
  if (!UNUSED_CHECK_JOB_STATUSES.includes(String(input.jobStatus) as JobStatus)) {
    return { ok: false, reason: "This job is not open for cleaning, so the office cannot be asked from here." };
  }
  return { ok: true };
}

export function isUnusedCheckDecision(value: unknown): value is UnusedCheckDecision {
  return typeof value === "string" && (UNUSED_CHECK_DECISIONS as readonly string[]).includes(value);
}

/** One question and its answer as the cleaner's screen shows it. */
export type UnusedCheckView = {
  id: string;
  jobId: string;
  status: "WAITING" | "ANSWERED";
  note: string | null;
  photoCount: number;
  askedAt: string;
  askedByMe: boolean;
  decision: UnusedCheckDecision | null;
  decisionNote: string | null;
  answeredAt: string | null;
};

/** GET /api/cleaner/jobs/[id]/unused-check. */
export type UnusedCheckCleanerPayload = {
  jobId: string;
  checks: UnusedCheckView[];
  canAsk: boolean;
  /** Why asking is not offered, when it is not. */
  refusal: string | null;
  /** The organisation timezone the times are shown in. */
  timeZone?: string;
};
