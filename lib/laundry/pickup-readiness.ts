/**
 * WAS THE LINEN ACTUALLY READY? — the driver's answer, and what it costs.
 *
 * A cleaner is meant to mark the linen ready before they leave. When they do
 * not, the driver still has to decide something on the doorstep, and until now
 * the only options were "mark it picked up" (which silently papered over the
 * miss) or "failed pickup" (which is wrong when the bags were sitting there).
 * Neither told anyone what actually happened, so the cleaner's record looked
 * identical whether they had forgotten a tick or left no linen at all.
 *
 * So the driver is asked one question, and only when the cleaner has not
 * already confirmed. Asking on EVERY pickup would be the more "complete"
 * design and the worse one: a question that is answered the same way ninety
 * times in a row stops being read, and the tenth answer is the one that matters.
 *
 * Two distinct failures come out of it, and they are not the same size:
 *
 *   NOT_READY   the linen was not there. The van made the trip for nothing and
 *               the next clean is short of stock. This is the expensive one.
 *   UNCONFIRMED the linen WAS there, but nobody said so. Cheaper — the work was
 *               done — but not free: the driver planned a route, and the office
 *               fielded a chase, on information that did not exist.
 *
 * Both land as QA penalties on the cleaner in the same shape the sanctioned
 * "no photo" waiver uses (lib/qa/no-photo-penalty.ts): the points join the
 * achievable maximum with nothing earned, so the percentage falls in proportion
 * rather than a flat number being subtracted from an unrelated total.
 *
 * PURE — no DB, no I/O.
 */

/** What the driver found when they arrived. */
export type PickupReadinessAnswer = "READY" | "NOT_READY";

/** One standard Pass/Minor/Fail question is worth 2 points — see lib/qa/scoring. */
export const LAUNDRY_NOT_READY_PENALTY_POINTS = 4;
export const LAUNDRY_UNCONFIRMED_PENALTY_POINTS = 2;

/** LaundryTask.status once the cleaner has ticked "ready for pickup". */
const CLEANER_CONFIRMED_STATUS = "CONFIRMED";

/**
 * Must the driver answer the readiness question for this pickup?
 *
 * Only when the cleaner never confirmed. A confirmed task already carries the
 * answer, and re-asking would be the ninety-first identical question.
 */
export function pickupNeedsReadinessAnswer(taskStatus: string): boolean {
  return taskStatus !== CLEANER_CONFIRMED_STATUS;
}

export interface LaundryPickupFacts {
  /** The cleaner ticked "ready for pickup" before the driver arrived. */
  cleanerConfirmed: boolean;
  /** What the driver reported. Null when they were never asked. */
  driverAnswer: PickupReadinessAnswer | null;
}

/** Same shape as lib/qa/scoring's QaScorePenalty — kept structural so this
 *  module stays free of a QA import and can be unit-tested on its own. */
export interface LaundryQaPenalty {
  points: number;
  label: string;
}

/**
 * What the pickup costs the cleaner's QA score.
 *
 * Returns an empty list whenever nothing was observed. A driver who was never
 * asked tells us nothing, and penalising on an absence of evidence would score
 * cleaners on which driver happened to run the route.
 */
export function buildLaundryQaPenalties(facts: LaundryPickupFacts): LaundryQaPenalty[] {
  if (facts.driverAnswer === "NOT_READY") {
    // Deliberately fires even when the cleaner DID confirm. Ticking "ready" for
    // linen that is not there is a worse miss than forgetting to tick at all,
    // and letting the confirmation suppress the penalty would reward it.
    return [
      {
        points: LAUNDRY_NOT_READY_PENALTY_POINTS,
        label: facts.cleanerConfirmed
          ? "Laundry — marked ready, but the driver found no linen at pickup"
          : "Laundry — not ready at pickup",
      },
    ];
  }

  if (facts.driverAnswer === "READY" && !facts.cleanerConfirmed) {
    return [
      {
        points: LAUNDRY_UNCONFIRMED_PENALTY_POINTS,
        label: "Laundry — was ready, but never marked ready before pickup",
      },
    ];
  }

  return [];
}

/**
 * The line the cleaner sees on their job once the driver has answered.
 *
 * Written from the cleaner's point of view, and it says who reported it: the
 * cleaner did not enter this, so the job must not look as though they did.
 */
export function describePickupReadiness(facts: LaundryPickupFacts): string | null {
  if (facts.driverAnswer === "NOT_READY") {
    return "The laundry driver reported the linen was not ready at pickup.";
  }
  if (facts.driverAnswer === "READY" && !facts.cleanerConfirmed) {
    return "The laundry driver confirmed the linen was ready — it was not marked ready before pickup.";
  }
  return null;
}

/**
 * Read the driver's answer back out of a LaundryConfirmation notes blob.
 *
 * The blob is untyped stored JSON, so anything unrecognised reads as "not
 * answered" rather than being coerced into one of the two outcomes.
 */
export function readPickupReadiness(notes: unknown): PickupReadinessAnswer | null {
  const parsed = parseNotes(notes);
  const value = parsed?.pickupReadiness;
  return value === "READY" || value === "NOT_READY" ? value : null;
}

function parseNotes(notes: unknown): Record<string, unknown> | null {
  if (notes && typeof notes === "object") return notes as Record<string, unknown>;
  if (typeof notes !== "string" || !notes.trim()) return null;
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The driver's answer for a task, taken from its confirmation rows.
 *
 * Scans for the PICKED_UP event specifically: a later DROPPED row carries its
 * own blob, and a task that was reverted and picked up again must report the
 * most recent pickup rather than the first.
 *
 * Sorts on `createdAt` instead of trusting array order. Callers in this repo
 * fetch confirmations both ascending and descending, so reading "the last
 * element" would return the newest answer for some callers and the oldest for
 * others — the same function quietly giving two different answers.
 */
export function resolvePickupReadinessFromConfirmations(
  confirmations:
    | ReadonlyArray<{ notes?: string | null; createdAt?: Date | string | null }>
    | null
    | undefined
): PickupReadinessAnswer | null {
  if (!Array.isArray(confirmations)) return null;

  const pickups = confirmations
    .map((row, index) => ({ parsed: parseNotes(row?.notes), at: timeOf(row?.createdAt), index }))
    .filter((row) => row.parsed?.event === "PICKED_UP");

  // Newest first. Rows with no createdAt keep their relative order behind the
  // dated ones rather than sorting to an arbitrary end.
  pickups.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || b.index - a.index);

  for (const row of pickups) {
    const answer = readPickupReadiness(row.parsed);
    if (answer) return answer;
  }
  return null;
}

function timeOf(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}
