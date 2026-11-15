/**
 * Words for a QA issue on the Quality hub's Issues tab, issue panel and the
 * inspection record (boards "QualitySubpages", "M-QualityDetail"). Pure: no
 * React, no database, so server pages, client components and tests share it.
 *
 * Nothing here decides anything. The fix age comes from the server's 48-hour
 * rule (lib/quality/fix-age.ts, sent on the row as `fixOwed`); statuses keep
 * their stored values and only gain readable labels. Unknown values read as
 * their own text, never as a success.
 */
import type { FixOwedAge } from "./fix-age";
import { FIX_OVERDUE_HOURS } from "./fix-age";
import { FIXED_RECTIFICATION_STATUSES, type FixedRectificationStatus, type RectificationStatusKey } from "./types";

/** "Fixed by" choices, worded as the bulk bar and the fix sheet draw them. */
export const FIXED_BY_LABEL: Readonly<Record<FixedRectificationStatus, string>> = {
  FIXED_BY_MANAGER: "Manager",
  FIXED_BY_QA: "QA",
  FIXED_BY_OTHER_CLEANER: "Other cleaner",
};

/** The fix sheet's "Or it is not fixed" choices (plus Still pending, so the old status list stays reachable). */
export const NOT_FIXED_CHOICES: ReadonlyArray<{ value: RectificationStatusKey; label: string }> = [
  { value: "RETURNED_TO_CLEANER", label: "Returned to cleaner" },
  { value: "NOT_FIXED", label: "Not fixed" },
  { value: "ESCALATED", label: "Escalated" },
  { value: "PENDING", label: "Still pending" },
];

const RECTIFICATION_LABEL: Readonly<Record<RectificationStatusKey, string>> = {
  PENDING: "Pending",
  FIXED_BY_QA: "Fixed by QA",
  RETURNED_TO_CLEANER: "Returned to cleaner",
  FIXED_BY_OTHER_CLEANER: "Fixed by other cleaner",
  FIXED_BY_MANAGER: "Fixed by manager",
  NOT_FIXED: "Not fixed",
  ESCALATED: "Escalated",
};

export function rectificationLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return RECTIFICATION_LABEL[status as RectificationStatusKey] ?? status;
}

const FALSE_CONFIRMATION_LABEL: Readonly<Record<string, string>> = {
  NONE: "None",
  SUSPECTED: "Suspected",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};

export function falseConfirmationLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return FALSE_CONFIRMATION_LABEL[status] ?? status;
}

export function isFixedStatus(status: string | null | undefined): boolean {
  return (FIXED_RECTIFICATION_STATUSES as readonly string[]).includes(status ?? "");
}

/** The facts the presentation reads from an issue row. */
export type IssuePresentationFacts = {
  severity: string;
  rectificationStatus: string;
  rectificationMinutes: number | null;
  rectificationCost: number | null;
  rectificationAfterKeys: unknown;
  falseConfirmation: string;
  fixOwed?: FixOwedAge | null;
};

/** Why a row is tinted, in words. Critical outranks an overdue fix. */
export type IssueAttention = { tone: "problem" | "attention"; reason: string };

export function issueAttention(issue: IssuePresentationFacts): IssueAttention | null {
  if (issue.severity === "CRITICAL") return { tone: "problem", reason: "Critical issue" };
  if (issue.fixOwed?.overdue) return { tone: "attention", reason: `Fix owed for over ${FIX_OVERDUE_HOURS} hours` };
  return null;
}

/** "52 h" under 3 days, "5 d" after; the 48-hour mark is added when overdue. */
export function fixAgeText(age: FixOwedAge): string {
  const span = age.hours < 72 ? `${age.hours} h` : `${Math.floor(age.hours / 24)} d`;
  return age.overdue ? `${span}, over ${FIX_OVERDUE_HOURS} h` : span;
}

function hasAfterPhoto(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some((key) => typeof key === "string" && key.length > 0);
}

/** A fixed issue with no after photo says so (owner default: allowed, but written). */
export function isNoAfterPhoto(issue: Pick<IssuePresentationFacts, "rectificationStatus" | "rectificationAfterKeys">): boolean {
  return isFixedStatus(issue.rectificationStatus) && !hasAfterPhoto(issue.rectificationAfterKeys);
}

export function formatAud(value: number): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/** The second line of the Fix cell. Null when there is nothing more to say. */
export function fixDetailText(issue: IssuePresentationFacts): string | null {
  if (issue.fixOwed) return fixAgeText(issue.fixOwed);
  if (!isFixedStatus(issue.rectificationStatus)) return null;
  const parts: string[] = [];
  if (typeof issue.rectificationMinutes === "number") parts.push(`${issue.rectificationMinutes} min`);
  if (typeof issue.rectificationCost === "number" && Number.isFinite(issue.rectificationCost)) parts.push(formatAud(issue.rectificationCost));
  if (isNoAfterPhoto(issue)) parts.push("No after photo");
  return parts.length ? parts.join(" · ") : null;
}

/** The second line of the False confirmation cell. */
export function falseConfirmationDetailText(status: string, deduction: number | null): string | null {
  if (status === "SUSPECTED") return "decide in the issue";
  if (status === "CONFIRMED" && deduction !== null) return `−${deduction} points`;
  return null;
}
