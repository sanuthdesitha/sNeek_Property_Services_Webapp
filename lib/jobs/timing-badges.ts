/**
 * Early-checkin / late-checkout timing badges.
 *
 * The rules live in the job's `internalNotes` meta and matter most to the
 * person doing the job: "do not start before 12:30 — guests are still inside"
 * and "must be guest-ready by 11:00" change what a cleaner does on arrival.
 * v1 showed them in the cleaner's list; the v2 rebuild kept the in-job banners
 * but dropped the list pills, so a cleaner scanning tomorrow's work saw no hint
 * that one of those jobs cannot be started when they had planned to.
 *
 * This module is the single derivation, shared by the admin `/api/jobs` list
 * (where it started, inline) and the cleaner's own list + Today screens. Pure —
 * no DB, no I/O.
 */
import { parseJobInternalNotes, resolveRuleTime } from "@/lib/jobs/meta";

export interface JobTimingBadges {
  /** Guest-ready by HH:MM — finish before this time. */
  early?: string;
  /** Do not start before HH:MM — guests are still in the property. */
  late?: string;
}

/** Resolve the badge times for one job, or null when neither rule is on. */
export function resolveTimingBadges(
  internalNotes: string | null | undefined
): JobTimingBadges | null {
  const meta = parseJobInternalNotes(internalNotes);
  const early = resolveRuleTime(meta.earlyCheckin);
  const late = resolveRuleTime(meta.lateCheckout);
  if (!early && !late) return null;
  return { ...(early ? { early } : {}), ...(late ? { late } : {}) };
}

/**
 * Attach `timingBadges` to a job row for list APIs, leaving the row untouched
 * when no rule applies (so the key's presence is itself the signal).
 */
export function withTimingBadges<T extends { internalNotes?: string | null }>(job: T) {
  const badges = resolveTimingBadges(job.internalNotes);
  return badges ? { ...job, timingBadges: badges } : job;
}

/**
 * Short pill text for a list row.
 *
 * Late checkout reads as the more urgent of the two — starting early means
 * walking in on guests, whereas finishing late is a service failure — so it
 * comes first and carries the danger tone.
 */
export function timingBadgeLabels(badges: JobTimingBadges | null | undefined): Array<{
  key: "late" | "early";
  label: string;
  tone: "danger" | "warning";
}> {
  if (!badges) return [];
  const out: Array<{ key: "late" | "early"; label: string; tone: "danger" | "warning" }> = [];
  if (badges.late) out.push({ key: "late", label: `Start after ${badges.late}`, tone: "danger" });
  if (badges.early) out.push({ key: "early", label: `Ready by ${badges.early}`, tone: "warning" });
  return out;
}
