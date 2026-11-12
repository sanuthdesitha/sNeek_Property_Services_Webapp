/**
 * The visit outcomes a maintenance worker can record when finishing, in the
 * order the finish screen lists them. The values are what
 * `POST /api/maintenance/[id]/visit` stores; changing this list changes data,
 * so tests pin it (tests/lib/maintenance-portal-redesign.test.ts,
 * tests/lib/maintenance-outcome-merge.test.ts).
 *
 * Owner decision 2026-11-12: the five drawn on the board. Migration
 * 20261113022000_maintenance_outcome_merge mapped the seven earlier values
 * (LEGACY_OUTCOME_MAP) and kept each changed row's original value in
 * PropertyMaintenanceItem.originalOutcome, which history views show as
 * "originally: Replaced".
 *
 * Pure: safe in server and client code.
 */

export type MaintenanceOutcomeValue =
  | "REPLACED_OR_REPAIRED"
  | "NEEDS_PARTS"
  | "NEEDS_FOLLOWUP"
  | "NO_ACCESS"
  | "NO_ISSUE_FOUND";

/** The seven values recorded before the merge. */
export type LegacyMaintenanceOutcome =
  | "FIXED"
  | "REPLACED"
  | "NEEDS_PARTS"
  | "NEEDS_FOLLOWUP"
  | "NO_ACCESS"
  | "NO_ISSUE_FOUND"
  | "OTHER";

export interface VisitOutcomeOption {
  value: MaintenanceOutcomeValue;
  label: string;
  /** One line under the choice on the finish screen. */
  hint: string;
}

export const VISIT_OUTCOMES: readonly VisitOutcomeOption[] = [
  { value: "REPLACED_OR_REPAIRED", label: "Replaced or repaired", hint: "Working now: repaired, or swapped for a new part or item" },
  { value: "NEEDS_PARTS", label: "Needs parts", hint: "Work order stays open until parts arrive" },
  { value: "NEEDS_FOLLOWUP", label: "Needs follow-up", hint: "Another visit is needed, or the office should look at it" },
  { value: "NO_ACCESS", label: "No access", hint: "Could not get in" },
  { value: "NO_ISSUE_FOUND", label: "No issue found", hint: "Checked; nothing wrong" },
];

export const DEFAULT_VISIT_OUTCOME: MaintenanceOutcomeValue = "REPLACED_OR_REPAIRED";

/**
 * How each earlier value maps onto the five. The migration uses exactly this
 * table (in SQL); the visit route uses it for a screen still sending an old
 * value, so nothing older can be rejected or silently dropped.
 */
export const LEGACY_OUTCOME_MAP: Readonly<Record<LegacyMaintenanceOutcome, MaintenanceOutcomeValue>> = {
  FIXED: "REPLACED_OR_REPAIRED",
  REPLACED: "REPLACED_OR_REPAIRED",
  NEEDS_PARTS: "NEEDS_PARTS",
  NEEDS_FOLLOWUP: "NEEDS_FOLLOWUP",
  NO_ACCESS: "NO_ACCESS",
  NO_ISSUE_FOUND: "NO_ISSUE_FOUND",
  // An unclassified result is not claimed as fixed: the office follows it up.
  OTHER: "NEEDS_FOLLOWUP",
};

const OUTCOME_LABELS: Readonly<Record<MaintenanceOutcomeValue | LegacyMaintenanceOutcome, string>> = {
  REPLACED_OR_REPAIRED: "Replaced or repaired",
  NEEDS_PARTS: "Needs parts",
  NEEDS_FOLLOWUP: "Needs follow-up",
  NO_ACCESS: "No access",
  NO_ISSUE_FOUND: "No issue found",
  FIXED: "Fixed",
  REPLACED: "Replaced",
  OTHER: "Other",
};

export function isCurrentOutcome(value: unknown): value is MaintenanceOutcomeValue {
  return typeof value === "string" && VISIT_OUTCOMES.some((option) => option.value === value);
}

export interface NormalizedOutcome {
  outcome: MaintenanceOutcomeValue;
  /** The value as sent when it was an earlier one; null when it is current. */
  original: LegacyMaintenanceOutcome | null;
}

/**
 * Accept a current or earlier outcome value. Unknown text is refused (null),
 * never guessed into an outcome.
 */
export function normalizeOutcomeInput(value: unknown): NormalizedOutcome | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toUpperCase();
  if (isCurrentOutcome(key)) return { outcome: key, original: null };
  if (key in LEGACY_OUTCOME_MAP) {
    const legacy = key as LegacyMaintenanceOutcome;
    return { outcome: LEGACY_OUTCOME_MAP[legacy], original: legacy };
  }
  return null;
}

/** Words for a stored or earlier outcome value; unknown text reads as itself. */
export function outcomeLabel(value: string | null | undefined): string {
  if (!value) return "";
  const label = OUTCOME_LABELS[value as MaintenanceOutcomeValue];
  if (label) return label;
  const lower = value.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "originally: Replaced" when the recorded value differs from what is stored now. */
export function originalOutcomeNote(
  outcome: string | null | undefined,
  originalOutcome: string | null | undefined
): string | null {
  if (!originalOutcome || originalOutcome === outcome) return null;
  return `originally: ${outcomeLabel(originalOutcome)}`;
}

/** "Replaced or repaired (originally: Replaced)", or just the label. */
export function outcomeWithOriginal(
  outcome: string | null | undefined,
  originalOutcome: string | null | undefined
): string {
  const label = outcomeLabel(outcome);
  const note = originalOutcomeNote(outcome, originalOutcome);
  return note ? `${label} (${note})` : label;
}
