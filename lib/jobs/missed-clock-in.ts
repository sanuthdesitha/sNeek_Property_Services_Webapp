/**
 * SOMEONE IS AT THE PROPERTY AND THE CLOCK IS NOT RUNNING.
 *
 * Cleaners forget to clock in. The cost lands twice: they get paid for less
 * than they worked, and ops sees an idle schedule for a job that is actually
 * being done. Both are discovered late — usually at payroll — and by then the
 * only repair available is somebody's memory of what time they arrived.
 *
 * There is already enough evidence to do better. Arrival is stamped when a
 * cleaner enters the geofence, and again far more strongly when they tap the
 * property's NFC tag. Location pings continue while they work. So a missed
 * clock-in is not an unknown: it is a known arrival with no timer attached.
 *
 * This module answers two questions and nothing else:
 *
 *   1. Should we nudge them? (they are here, the clock is not running)
 *   2. If they start late, what time does the EVIDENCE support?
 *
 * The second matters more than it looks. Offering to backdate to a remembered
 * time invites a guess, and a guess in a pay record is worse than a late start
 * honestly recorded. Backdating to a tag tap or a geofence entry is a fact with
 * a timestamp — which is why the source is returned alongside the time. A
 * reviewer has to be able to see WHY a shift began before anyone pressed a
 * button.
 *
 * PURE — no DB, no I/O.
 */

/** Where a proposed start time came from. Ranked strongest first. */
export type ArrivalEvidence = "NFC_TAG" | "GEOFENCE" | "FIRST_PING" | "NONE";

/**
 * How long someone can be on site before it counts as forgotten rather than as
 * still unloading the car. Short enough to catch it early in the clean, long
 * enough that arriving, finding the key and putting bags down does not fire a
 * notification every single time.
 */
export const MISSED_CLOCK_IN_GRACE_MS = 12 * 60 * 1000;

/**
 * Never backdate further than this. A stale `arrivedAt` from a cleaner who
 * drove past yesterday, or a geofence hit from the flat next door, would
 * otherwise open a shift in the middle of the night.
 */
export const MAX_BACKDATE_MS = 10 * 60 * 60 * 1000;

export interface ClockInEvidence {
  /** An accepted NFC tap on this job by this cleaner. The strongest signal. */
  tagTapAt?: Date | null;
  /** Geofence arrival, as stamped on the job. */
  arrivedAt?: Date | null;
  /** The earliest location ping recorded for this cleaner on this job. */
  firstPingAt?: Date | null;
  /** True when a TimeLog is currently open for this cleaner on this job. */
  clockRunning: boolean;
}

export interface MissedClockIn {
  /** Worth prompting this cleaner right now. */
  shouldPrompt: boolean;
  /** The start time the evidence supports, if any. */
  proposedStartAt: Date | null;
  evidence: ArrivalEvidence;
  /** Minutes between the evidenced arrival and now. */
  minutesOnSite: number;
}

/**
 * Assess one cleaner on one job.
 *
 * `evidence` is the STRONGEST available source, not the earliest — a tag tap
 * beats a geofence hit even when the geofence fired first, because a tap is a
 * deliberate act at the door while a geofence hit can be the neighbour's
 * driveway. The proposed time comes from that same chosen source, so the two
 * never disagree.
 */
export function assessMissedClockIn(
  input: ClockInEvidence,
  now: Date = new Date()
): MissedClockIn {
  const none: MissedClockIn = {
    shouldPrompt: false,
    proposedStartAt: null,
    evidence: "NONE",
    minutesOnSite: 0,
  };

  // A running clock is precisely the thing this exists to detect the absence of.
  if (input.clockRunning) return none;

  let evidence: ArrivalEvidence = "NONE";
  let arrival: Date | null = null;

  if (isUsable(input.tagTapAt)) {
    evidence = "NFC_TAG";
    arrival = input.tagTapAt as Date;
  } else if (isUsable(input.arrivedAt)) {
    evidence = "GEOFENCE";
    arrival = input.arrivedAt as Date;
  } else if (isUsable(input.firstPingAt)) {
    evidence = "FIRST_PING";
    arrival = input.firstPingAt as Date;
  }

  if (!arrival) return none;

  const elapsed = now.getTime() - arrival.getTime();
  // A negative gap is clock skew, not somebody arriving in the future. Treat it
  // as "just arrived" rather than as evidence of anything.
  const minutesOnSite = Math.max(0, Math.round(elapsed / 60_000));

  // Too old to trust. Prompting at 9pm about a 7am arrival — or offering to
  // open a shift back then — is worse than staying quiet.
  if (elapsed > MAX_BACKDATE_MS) {
    return { ...none, evidence, minutesOnSite };
  }

  return {
    shouldPrompt: elapsed >= MISSED_CLOCK_IN_GRACE_MS,
    proposedStartAt: arrival,
    evidence,
    minutesOnSite,
  };
}

function isUsable(value: Date | null | undefined): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

const EVIDENCE_PHRASE: Record<ArrivalEvidence, string> = {
  NFC_TAG: "you tapped the tag",
  GEOFENCE: "your phone reached the property",
  FIRST_PING: "your phone was first seen there",
  NONE: "you arrived",
};

/**
 * What the cleaner is asked, in their own terms.
 *
 * Names the evidence out loud so the offer is checkable rather than magical.
 * Somebody being told their shift will be backdated should be able to see what
 * that claim rests on, and say no.
 */
export function describeMissedClockIn(result: MissedClockIn): string | null {
  if (!result.shouldPrompt || !result.proposedStartAt) return null;
  return `You have been on site about ${result.minutesOnSite} minutes and the clock is not running. Start now, or begin from when ${EVIDENCE_PHRASE[result.evidence]}?`;
}
