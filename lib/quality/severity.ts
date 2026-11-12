/**
 * The ONE place a QA issue severity becomes words on an office screen.
 *
 * The system has exactly three stored severities (Prisma `QaIssueSeverity`:
 * MINOR, MAJOR, CRITICAL). The office designs call them Low / Medium / High,
 * so the admin Quality hub, the Cases "Raise QA issue" dialog and the Quality
 * CSV export read them through this mapping. It is display only:
 *
 * - Stored values, API values and filter query values stay MINOR / MAJOR /
 *   CRITICAL (`?severity=CRITICAL` still means the same thing).
 * - Other portals (cleaner and QA inspector screens) keep their own wording;
 *   nothing outside the admin Quality surfaces imports this.
 * - There is no fourth level. An unknown value (a future enum member) is shown
 *   as its own title-cased text, never folded into Low / Medium / High.
 *
 * Pure: safe in the browser and on the server.
 */
import { ISSUE_SEVERITIES, titleCaseKey, type IssueSeverity } from "./types";

export const SEVERITY_LABEL: Readonly<Record<IssueSeverity, string>> = {
  MINOR: "Low",
  MAJOR: "Medium",
  CRITICAL: "High",
};

/** Compact lower-case form for count pills ("2 low", "1 med", "2 high"), as drawn. */
export const SEVERITY_SHORT_LABEL: Readonly<Record<IssueSeverity, string>> = {
  MINOR: "low",
  MAJOR: "med",
  CRITICAL: "high",
};

export function isIssueSeverity(value: unknown): value is IssueSeverity {
  return typeof value === "string" && (ISSUE_SEVERITIES as readonly string[]).includes(value);
}

/** "Low" / "Medium" / "High" for a stored severity; an unknown value reads as itself. */
export function severityLabel(value: string | null | undefined): string {
  if (isIssueSeverity(value)) return SEVERITY_LABEL[value];
  return titleCaseKey(value);
}

/** "3 med" for a count pill. */
export function severityCountLabel(count: number, severity: IssueSeverity): string {
  return `${count} ${SEVERITY_SHORT_LABEL[severity]}`;
}
