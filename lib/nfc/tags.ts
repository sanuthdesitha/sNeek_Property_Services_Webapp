/**
 * NFC TAG CHECK-IN — what a tap means, and what it does not.
 *
 * A tag at the door holds a URL ending in a token. Every modern phone can read
 * that without an app: iOS surfaces it from the lock screen, Android Chrome can
 * also read it in-page via Web NFC. That is the whole reason the payload is a
 * URL rather than anything app-specific — an iPhone cannot read a custom NDEF
 * record from a web page at all.
 *
 * WHAT THE TOKEN IS NOT: a secret. The business chose commodity NTAG21x tags,
 * which anyone can clone in seconds with a phone. So the token is an
 * IDENTIFIER, and a tap on its own proves nothing. What makes a scan meaningful
 * is everything around it:
 *
 *   - it must arrive with an authenticated CLEANER session — a copied tag is
 *     worthless to someone who cannot log in as that person;
 *   - that cleaner must have a job at THAT property inside a sane window;
 *   - the tap is deduplicated, so one physical tap is one event;
 *   - every scan is recorded, accepted or not, so the pattern is auditable.
 *
 * The residual risk is a cleaner cloning their OWN tag to check in from
 * somewhere else. Cheap tags cannot close that; NTAG 424 DNA (per-tap CMAC)
 * can, and this module is shaped so such verification could slot in later
 * without its callers changing. Until then the compensating control is that
 * location is still captured at the tap and a large mismatch stays visible to
 * ops — the tap removes the geofence as a BLOCKER, not as a record.
 *
 * PURE — no DB, no I/O.
 */

import { sydneyDateKey } from "@/lib/time/sydney-range";

/** Why a scan did or did not become a check-in. Stored on every attempt. */
export type NfcScanOutcome =
  | "ACCEPTED"
  | "NO_TAG"
  | "INACTIVE_TAG"
  | "NOT_A_CLEANER"
  | "NO_JOB"
  | "MULTIPLE_JOBS"
  | "DUPLICATE";

/** What the tap should do, once a job is settled on. */
export type NfcScanAction = "CHECK_IN" | "CHECK_OUT";

/**
 * How close to its scheduled time a job has to be for a tap at its property to
 * count. Deliberately generous in both directions: cleaners arrive early to
 * beat traffic and finish late when a place is worse than expected, and a
 * window that punishes either is a window that sends people back to tapping
 * buttons. Narrow enough that two jobs a day apart never both match.
 */
export const SCAN_WINDOW_BEFORE_MS = 6 * 60 * 60 * 1000;
export const SCAN_WINDOW_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Two taps closer together than this are one tap.
 *
 * Phones fire these events more than once — iOS in particular can open the URL
 * again when the notification is tapped after the page has already loaded — and
 * without this a double read would check somebody in and straight back out.
 */
export const SCAN_DEDUPE_MS = 30 * 1000;

/** Statuses where the next sensible thing a tap can do is start the job. */
const CHECK_IN_STATUSES = new Set(["ASSIGNED", "OFFERED", "EN_ROUTE", "UNASSIGNED"]);
/** Statuses where the cleaner is already working, so a tap means "I'm done". */
const CHECK_OUT_STATUSES = new Set(["IN_PROGRESS", "PAUSED"]);

export interface ScanCandidateJob {
  id: string;
  status: string;
  scheduledDate: Date;
}

export interface ScanResolution {
  outcome: NfcScanOutcome;
  job?: ScanCandidateJob;
  action?: NfcScanAction;
}

/** Is this job close enough in time for a tap right now to mean it? */
export function isJobInScanWindow(job: ScanCandidateJob, now: Date): boolean {
  const scheduled = job.scheduledDate.getTime();
  const nowMs = now.getTime();
  if (nowMs >= scheduled - SCAN_WINDOW_BEFORE_MS && nowMs <= scheduled + SCAN_WINDOW_AFTER_MS) {
    return true;
  }
  // A job scheduled for today in Sydney always counts, even if the clock has
  // run past the window — an all-day booking with a midnight scheduledDate
  // would otherwise fall out of range by the afternoon.
  return sydneyDateKey(job.scheduledDate) === sydneyDateKey(now);
}

/**
 * Which job does this tap mean, and what should it do?
 *
 * Prefers a job already under way: if the cleaner is mid-clean at this
 * property, the tap can only sensibly mean "finished". Otherwise the job they
 * have turned up for is the one still waiting to be started.
 *
 * Returns MULTIPLE_JOBS rather than guessing when two are equally plausible.
 * Guessing would clock somebody into the wrong job — a payroll and QA problem
 * that surfaces days later — and the cost of asking is one tap on a list.
 */
export function resolveScanJob(
  candidates: readonly ScanCandidateJob[],
  now: Date
): ScanResolution {
  const inWindow = candidates.filter((job) => isJobInScanWindow(job, now));
  if (inWindow.length === 0) return { outcome: "NO_JOB" };

  const started = inWindow.filter((job) => CHECK_OUT_STATUSES.has(job.status));
  if (started.length === 1) {
    return { outcome: "ACCEPTED", job: started[0], action: "CHECK_OUT" };
  }
  if (started.length > 1) return { outcome: "MULTIPLE_JOBS" };

  const startable = inWindow.filter((job) => CHECK_IN_STATUSES.has(job.status));
  if (startable.length === 0) {
    // Everything here is already submitted or completed. Nothing a tap can do.
    return { outcome: "NO_JOB" };
  }
  if (startable.length > 1) {
    // Same property, same cleaner, two open jobs in one window. Rare, and
    // exactly the case where picking one silently would be wrong.
    return { outcome: "MULTIPLE_JOBS" };
  }

  return { outcome: "ACCEPTED", job: startable[0], action: "CHECK_IN" };
}

/** Is this tap a repeat of one we just handled? */
export function isDuplicateScan(
  lastScanAt: Date | null | undefined,
  now: Date,
  windowMs: number = SCAN_DEDUPE_MS
): boolean {
  if (!lastScanAt) return false;
  const gap = now.getTime() - lastScanAt.getTime();
  // A negative gap means clock skew between the row and now. Treat it as
  // recent rather than ancient — the cost of one ignored tap is a re-tap, the
  // cost of a wrong one is a bad time record on someone's pay.
  return gap < windowMs;
}

/** The URL that gets written onto the physical tag. */
export function buildTagUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/t/${encodeURIComponent(token)}`;
}

/**
 * Plain-language outcomes. The cleaner is standing at a door holding a phone,
 * so each one says what to do next rather than naming the failure.
 */
export const SCAN_OUTCOME_MESSAGE: Record<NfcScanOutcome, string> = {
  ACCEPTED: "Checked in.",
  NO_TAG: "This tag is not registered. Check in from the job screen and tell the office.",
  INACTIVE_TAG: "This tag has been retired. Check in from the job screen instead.",
  NOT_A_CLEANER: "Only cleaners can check in by tapping a tag.",
  NO_JOB: "You have no job at this property right now. Check your schedule.",
  MULTIPLE_JOBS: "You have more than one job here — pick the right one.",
  DUPLICATE: "Already registered a moment ago.",
};
