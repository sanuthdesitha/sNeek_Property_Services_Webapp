/**
 * QA per-item verdict scales (owner decision 2026-11-12: "Fail" replaces Major
 * and Critical for new inspections).
 *
 * - FAIL (new inspections): Pass / Minor / Fail / N/A. A Fail can carry an
 *   optional "Serious" tick that the inspector sets. Serious carries every
 *   consequence that only Critical used to have (its larger deduction, the
 *   management-review flag and notice, breaking the cleaner's bonus streak,
 *   the "critical" counts in performance and the inspection brief).
 * - MAJOR_CRITICAL (history): Pass / Minor / Major / Critical / N/A. Kept by
 *   inspections started or completed before the change, including amendments
 *   (reopen) of them. Their stored results are never re-labelled.
 *
 * Storage: a Fail is written to the existing severity grouping so every count,
 * chart, streak and pattern keeps working without a second code path:
 *   Fail            -> QaIssue.severity MAJOR    + failVerdict
 *   Fail + Serious  -> QaIssue.severity CRITICAL + failVerdict + serious
 * Screens read `failVerdict` to say "Fail" instead of the severity word.
 *
 * Pure: no React, no Prisma runtime import. Safe in server and client code.
 */

export type QaVerdictScaleKey = "FAIL" | "MAJOR_CRITICAL";

/** Every verdict the wire contract accepts, across both scales. */
export type QaItemVerdict = "PASS" | "MINOR" | "FAIL" | "MAJOR" | "CRITICAL" | "NA";

/** Stored QaIssue severities (Prisma `QaIssueSeverity`). */
export type QaStoredSeverity = "MINOR" | "MAJOR" | "CRITICAL";

/**
 * The day the Fail scale starts, as shown in legends ("Major (before …)").
 * It is the date of migration 20261113021000_qa_fail_verdict; inspections
 * that existed when it ran were stamped MAJOR_CRITICAL.
 */
export const FAIL_SCALE_FROM_LABEL = "13 Nov 2026";

export const VERDICTS_BY_SCALE: Readonly<Record<QaVerdictScaleKey, readonly QaItemVerdict[]>> = {
  FAIL: ["PASS", "MINOR", "FAIL", "NA"],
  MAJOR_CRITICAL: ["PASS", "MINOR", "MAJOR", "CRITICAL", "NA"],
};

/** A missing or unknown scale is the current one: new work never gets the old options by accident. */
export function normalizeVerdictScale(value: unknown): QaVerdictScaleKey {
  return value === "MAJOR_CRITICAL" ? "MAJOR_CRITICAL" : "FAIL";
}

export function verdictOptionsForScale(scale: QaVerdictScaleKey): readonly QaItemVerdict[] {
  return VERDICTS_BY_SCALE[scale];
}

export function isVerdictAllowedOnScale(verdict: string, scale: QaVerdictScaleKey): boolean {
  return (VERDICTS_BY_SCALE[scale] as readonly string[]).includes(verdict);
}

/**
 * The entries an inspection may not record on its stored scale. The submit
 * route refuses these with the reason (409) instead of re-mapping them.
 */
export function offScaleVerdicts<T extends { verdict: string }>(entries: readonly T[], scale: QaVerdictScaleKey): T[] {
  return entries.filter((entry) => !isVerdictAllowedOnScale(entry.verdict, scale));
}

/** Verdicts that raise an issue (need a category and description). */
export function isFlaggingVerdict(verdict: string): boolean {
  return verdict === "MINOR" || verdict === "FAIL" || verdict === "MAJOR" || verdict === "CRITICAL";
}

/** Where a verdict lands in the stored severity grouping. PASS / NA raise nothing. */
export function storedSeverityForVerdict(verdict: QaItemVerdict, serious: boolean): QaStoredSeverity | null {
  switch (verdict) {
    case "MINOR":
      return "MINOR";
    case "FAIL":
      return serious ? "CRITICAL" : "MAJOR";
    case "MAJOR":
      return "MAJOR";
    case "CRITICAL":
      return "CRITICAL";
    default:
      return null;
  }
}

export interface QaIssueVerdictFacts {
  severity: string;
  failVerdict?: boolean | null;
  serious?: boolean | null;
}

export interface VerdictLabelOptions {
  /** Add "(before 13 Nov 2026)" to Major / Critical, for legends that mix both scales. */
  legend?: boolean;
}

/**
 * The inspector-facing word for a stored issue: "Minor", "Fail",
 * "Fail · serious", or — for history — "Major" / "Critical" exactly as recorded.
 */
export function qaIssueVerdictLabel(issue: QaIssueVerdictFacts, options: VerdictLabelOptions = {}): string {
  if (issue.failVerdict) return issue.serious ? "Fail · serious" : "Fail";
  const suffix = options.legend ? ` (before ${FAIL_SCALE_FROM_LABEL})` : "";
  switch (issue.severity) {
    case "MINOR":
      return "Minor";
    case "MAJOR":
      return `Major${suffix}`;
    case "CRITICAL":
      return `Critical${suffix}`;
    default:
      return issue.severity ? issue.severity.charAt(0) + issue.severity.slice(1).toLowerCase() : "Unknown";
  }
}

/** Per-label counts of stored issues, split so Fail and history never merge in words. */
export interface VerdictLabelCounts {
  minor: number;
  fail: number;
  seriousFail: number;
  major: number;
  critical: number;
}

export function countIssuesByVerdict(issues: readonly QaIssueVerdictFacts[]): VerdictLabelCounts {
  const counts: VerdictLabelCounts = { minor: 0, fail: 0, seriousFail: 0, major: 0, critical: 0 };
  for (const issue of issues) {
    if (issue.failVerdict) {
      if (issue.serious) counts.seriousFail += 1;
      else counts.fail += 1;
    } else if (issue.severity === "MINOR") counts.minor += 1;
    else if (issue.severity === "MAJOR") counts.major += 1;
    else if (issue.severity === "CRITICAL") counts.critical += 1;
  }
  return counts;
}

/**
 * The legend for the office's Low / Medium / High severity grouping once both
 * scales exist: which verdicts each band holds.
 */
export const SEVERITY_GROUPING_LEGEND: readonly string[] = [
  "Low: Minor.",
  `Medium: Fail, and Major (before ${FAIL_SCALE_FROM_LABEL}).`,
  `High: Fail marked serious, and Critical (before ${FAIL_SCALE_FROM_LABEL}).`,
];
