/**
 * The visit outcomes a maintenance worker can record when finishing, in the
 * order the finish screen lists them. The values are what
 * `POST /api/maintenance/[id]/visit` stores; changing this list changes data,
 * so tests pin it (tests/lib/maintenance-portal-redesign.test.ts).
 *
 * The approved board draws five choices ("Replaced or repaired" plus four).
 * The app records seven, so Fixed and Replaced stay separate and Other stays:
 * merging them would change what the office reads on the ticket.
 */
export interface VisitOutcomeOption {
  value: string;
  label: string;
  /** One line under the choice on the finish screen. */
  hint: string;
}

export const VISIT_OUTCOMES: readonly VisitOutcomeOption[] = [
  { value: "FIXED", label: "Fixed", hint: "Repaired; working now" },
  { value: "REPLACED", label: "Replaced", hint: "Swapped for a new part or item" },
  { value: "NEEDS_PARTS", label: "Needs parts", hint: "Work order stays open until parts arrive" },
  { value: "NEEDS_FOLLOWUP", label: "Needs follow-up", hint: "Another visit is needed" },
  { value: "NO_ACCESS", label: "No access", hint: "Could not get in" },
  { value: "NO_ISSUE_FOUND", label: "No issue found", hint: "Checked; nothing wrong" },
  { value: "OTHER", label: "Other", hint: "Explain in what was done" },
];
