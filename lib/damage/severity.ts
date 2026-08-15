/**
 * The bridge between the two severity scales damage reporting has to speak.
 *
 * A cleaner grades what they can actually see — how bad the damage LOOKS
 * (DamageSeverity: MINOR | MODERATE | MAJOR | SEVERE). Ops runs on how urgent
 * the work is (IssueTicket.severity: LOW | MEDIUM | HIGH | CRITICAL), and CP-7
 * turns that into a maintenance priority in
 * lib/cases/damage-maintenance.ts#maintenancePriorityForSeverity.
 *
 * Keeping one scale for both would have forced a bad trade: either cleaners
 * triage the ops queue, or the queue inherits whatever word a cleaner picked.
 * The mapping is here, in one place, so the two vocabularies stay independent.
 *
 * Why it matters that this is explicit: the previous submit path hardcoded
 * `severity: damage.severity ?? "HIGH"`, so anything a cleaner sent that was
 * not already an IssueTicket severity fell through to MEDIUM priority. Every
 * SEVERE report would have queued at the same urgency as a scuffed skirting
 * board.
 */

import { DamageSeverity } from "@prisma/client";

/** IssueTicket.severity is a free string column; these are its accepted values. */
export type CaseSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const CASE_SEVERITY_BY_DAMAGE: Record<DamageSeverity, CaseSeverity> = {
  [DamageSeverity.MINOR]: "LOW",
  [DamageSeverity.MODERATE]: "MEDIUM",
  [DamageSeverity.MAJOR]: "HIGH",
  [DamageSeverity.SEVERE]: "CRITICAL",
};

/**
 * Map a cleaner's grading onto the case severity CP-7 reads.
 *
 * Falls back to MEDIUM for anything unrecognised rather than throwing: a
 * damage report that reached submit must not be lost because of one bad enum,
 * and MEDIUM is the honest "we do not know how urgent this is" answer.
 */
export function caseSeverityForDamage(
  severity: DamageSeverity | string | null | undefined
): CaseSeverity {
  const key = String(severity ?? "").trim().toUpperCase() as DamageSeverity;
  return CASE_SEVERITY_BY_DAMAGE[key] ?? "MEDIUM";
}

/** Cleaner-facing labels. Ordered least → most severe, which is picker order. */
export const DAMAGE_SEVERITY_OPTIONS = [
  { value: DamageSeverity.MINOR, label: "Minor", hint: "Cosmetic — still usable" },
  { value: DamageSeverity.MODERATE, label: "Moderate", hint: "Noticeable, needs repair" },
  { value: DamageSeverity.MAJOR, label: "Major", hint: "Unusable or unsafe to use" },
  { value: DamageSeverity.SEVERE, label: "Severe", hint: "Urgent — risk to the next guest" },
] as const;

/** Ordering helper so a report can lead with its worst item. */
const SEVERITY_RANK: Record<DamageSeverity, number> = {
  [DamageSeverity.MINOR]: 0,
  [DamageSeverity.MODERATE]: 1,
  [DamageSeverity.MAJOR]: 2,
  [DamageSeverity.SEVERE]: 3,
};

export function damageSeverityRank(severity: DamageSeverity): number {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * The worst severity across a report's items, or null when it has none.
 * Drives the report-level badge; a report is as urgent as its worst item.
 */
export function highestDamageSeverity(
  severities: ReadonlyArray<DamageSeverity>
): DamageSeverity | null {
  if (severities.length === 0) return null;
  return severities.reduce((worst, current) =>
    damageSeverityRank(current) > damageSeverityRank(worst) ? current : worst
  );
}
