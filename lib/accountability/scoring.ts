/**
 * Accountability scoring engine (Phase 4a).
 *
 * A deduction-based QA score: every clean starts at 100 and loses points per
 * flagged item (per-verdict severity), per missing mandatory evidence field, and
 * per suspected false confirmation. The result maps to a rating band and a
 * pass/fail decision. Any CRITICAL verdict force-routes the review to management
 * (regardless of the numeric score) when the setting is enabled.
 *
 * This module is the CONTRACT shared between the QA submit API
 * (`app/api/qa/jobs/[id]/route.ts`) and the QA review UI — the exported types are
 * the request/response shapes both sides build against. It is intentionally pure
 * (no DB, no I/O) so it can be unit-tested and reused on the client.
 *
 * The legacy percent engine (`lib/qa/scoring.ts`) is unrelated and stays in place
 * for template-based scoring; this engine is only used when a QA submit carries an
 * `accountability` assessment blob.
 */
import type { AccountabilityScoringSettings } from "@/lib/settings";

export type { AccountabilityScoringSettings };

export type AccountabilityVerdict = "PASS" | "MINOR" | "MAJOR" | "CRITICAL" | "NA";

export type AccountabilityRating =
  | "EXCELLENT"
  | "PASS"
  | "NEEDS_IMPROVEMENT"
  | "FAILED"
  | "MANAGEMENT_REVIEW";

export interface AccountabilityVerdictEntry {
  fieldId: string;
  itemKey?: string | null;
  label?: string | null;
  verdict: AccountabilityVerdict;
  /** settings issueCategories key (required for MINOR+) */
  category?: string | null;
  /** required for MINOR+ */
  description?: string | null;
  guestReadyImpact?: boolean;
  /** cleaner ticked/claimed this item */
  cleanerMarkedComplete?: boolean;
  qaPhotoKeys?: { key: string; annotatedKey?: string | null }[];
  cleanerMediaIds?: string[];
}

export interface AccountabilityFalseConfirmation {
  fieldId: string;
  itemKey?: string | null;
  description?: string | null;
}

export interface AccountabilityAssessmentInput {
  verdicts: AccountabilityVerdictEntry[];
  /** −missingMandatoryEvidenceDeduction each */
  missingMandatoryEvidenceFieldIds?: string[];
  /** extra −falseConfirmationExtraDeduction each; marks the QaIssue SUSPECTED */
  suspectedFalseConfirmations?: AccountabilityFalseConfirmation[];
}

export type AccountabilityDeductionKind =
  | "MINOR"
  | "MAJOR"
  | "CRITICAL"
  | "MISSING_EVIDENCE"
  | "FALSE_CONFIRMATION";

export interface AccountabilityDeduction {
  kind: AccountabilityDeductionKind;
  fieldId?: string;
  amount: number;
}

export interface AccountabilityScoreResult {
  /** 100 − deductions, floored */
  rawScore: number;
  deductions: AccountabilityDeduction[];
  rating: AccountabilityRating;
  /** any CRITICAL (when criticalTriggersManagementReview) — rating becomes MANAGEMENT_REVIEW */
  managementReview: boolean;
  /** rating EXCELLENT|PASS */
  passed: boolean;
  counts: {
    minor: number;
    major: number;
    critical: number;
    missingEvidence: number;
    falseConfirmations: number;
  };
}

const SEVERITY_DEDUCTION_KIND: Record<
  "MINOR" | "MAJOR" | "CRITICAL",
  AccountabilityDeductionKind
> = { MINOR: "MINOR", MAJOR: "MAJOR", CRITICAL: "CRITICAL" };

/**
 * Compute the accountability score for a QA assessment.
 *
 * Rules:
 *  - start at 100
 *  - MINOR −minorDeduction, MAJOR −majorDeduction, CRITICAL −criticalDeduction per verdict
 *  - each missing mandatory-evidence id −missingMandatoryEvidenceDeduction
 *  - each suspected false confirmation an EXTRA −falseConfirmationExtraDeduction
 *    (on top of the flagged item's own verdict deduction)
 *  - PASS / NA verdicts deduct nothing
 *  - floor the result at `floor`
 *  - rating: ≥excellentMin EXCELLENT, ≥passMin PASS, ≥needsImprovementMin
 *    NEEDS_IMPROVEMENT, else FAILED
 *  - any CRITICAL verdict + criticalTriggersManagementReview → rating
 *    MANAGEMENT_REVIEW + managementReview true, regardless of the numeric score
 */
export function computeAccountabilityScore(
  input: AccountabilityAssessmentInput,
  scoring: AccountabilityScoringSettings
): AccountabilityScoreResult {
  const deductions: AccountabilityDeduction[] = [];
  const counts = { minor: 0, major: 0, critical: 0, missingEvidence: 0, falseConfirmations: 0 };
  let hasCritical = false;

  const severityAmount: Record<"MINOR" | "MAJOR" | "CRITICAL", number> = {
    MINOR: scoring.minorDeduction,
    MAJOR: scoring.majorDeduction,
    CRITICAL: scoring.criticalDeduction,
  };

  for (const entry of input.verdicts ?? []) {
    const v = entry.verdict;
    if (v !== "MINOR" && v !== "MAJOR" && v !== "CRITICAL") continue; // PASS / NA deduct nothing
    if (v === "MINOR") counts.minor += 1;
    else if (v === "MAJOR") counts.major += 1;
    else {
      counts.critical += 1;
      hasCritical = true;
    }
    deductions.push({
      kind: SEVERITY_DEDUCTION_KIND[v],
      fieldId: entry.fieldId,
      amount: severityAmount[v],
    });
  }

  for (const fieldId of input.missingMandatoryEvidenceFieldIds ?? []) {
    counts.missingEvidence += 1;
    deductions.push({
      kind: "MISSING_EVIDENCE",
      fieldId,
      amount: scoring.missingMandatoryEvidenceDeduction,
    });
  }

  for (const fc of input.suspectedFalseConfirmations ?? []) {
    counts.falseConfirmations += 1;
    deductions.push({
      kind: "FALSE_CONFIRMATION",
      fieldId: fc.fieldId,
      amount: scoring.falseConfirmationExtraDeduction,
    });
  }

  const totalDeduction = deductions.reduce((sum, d) => sum + d.amount, 0);
  const rawScore = Math.max(scoring.floor, 100 - totalDeduction);

  const managementReview = hasCritical && scoring.criticalTriggersManagementReview;
  let rating: AccountabilityRating;
  if (managementReview) {
    rating = "MANAGEMENT_REVIEW";
  } else if (rawScore >= scoring.excellentMin) {
    rating = "EXCELLENT";
  } else if (rawScore >= scoring.passMin) {
    rating = "PASS";
  } else if (rawScore >= scoring.needsImprovementMin) {
    rating = "NEEDS_IMPROVEMENT";
  } else {
    rating = "FAILED";
  }

  const passed = rating === "EXCELLENT" || rating === "PASS";

  return { rawScore, deductions, rating, managementReview, passed, counts };
}

const VALID_VERDICTS: AccountabilityVerdict[] = ["PASS", "MINOR", "MAJOR", "CRITICAL", "NA"];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeQaPhotoKeys(value: unknown): { key: string; annotatedKey?: string | null }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: { key: string; annotatedKey?: string | null }[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const key = asString((raw as Record<string, unknown>).key);
    if (!key) continue;
    const annotatedKey = asString((raw as Record<string, unknown>).annotatedKey);
    out.push({ key, annotatedKey: annotatedKey ?? null });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map(asString).filter((s): s is string => Boolean(s));
  return out.length > 0 ? out : undefined;
}

/**
 * Defensive parse of the request `accountability` blob into the strict input
 * shape. Returns null when the blob is absent, malformed, or empty (no verdicts,
 * no missing-evidence ids, no false confirmations). Invalid issue categories on
 * a MINOR+ verdict fall back to "other". Unknown verdict strings become "NA".
 */
export function sanitizeAccountabilityAssessment(
  raw: unknown,
  validCategories: string[]
): AccountabilityAssessmentInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const categorySet = new Set(validCategories);

  const verdicts: AccountabilityVerdictEntry[] = [];
  if (Array.isArray(row.verdicts)) {
    for (const rawEntry of row.verdicts) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const e = rawEntry as Record<string, unknown>;
      const fieldId = asString(e.fieldId);
      if (!fieldId) continue;

      const rawVerdict = typeof e.verdict === "string" ? e.verdict.trim().toUpperCase() : "";
      const verdict = (VALID_VERDICTS.includes(rawVerdict as AccountabilityVerdict)
        ? rawVerdict
        : "NA") as AccountabilityVerdict;

      const isFlagged = verdict === "MINOR" || verdict === "MAJOR" || verdict === "CRITICAL";
      let category = asString(e.category);
      if (isFlagged) {
        // MINOR+ verdicts must carry a valid category; fall back to "other".
        category = category && categorySet.has(category) ? category : "other";
      } else if (category && !categorySet.has(category)) {
        category = "other";
      }

      verdicts.push({
        fieldId,
        itemKey: asString(e.itemKey),
        label: asString(e.label),
        verdict,
        category,
        description: asString(e.description),
        guestReadyImpact: e.guestReadyImpact === true,
        cleanerMarkedComplete: e.cleanerMarkedComplete === true,
        qaPhotoKeys: sanitizeQaPhotoKeys(e.qaPhotoKeys),
        cleanerMediaIds: sanitizeStringArray(e.cleanerMediaIds),
      });
    }
  }

  const missingMandatoryEvidenceFieldIds = sanitizeStringArray(row.missingMandatoryEvidenceFieldIds) ?? [];

  const suspectedFalseConfirmations: AccountabilityFalseConfirmation[] = [];
  if (Array.isArray(row.suspectedFalseConfirmations)) {
    for (const rawFc of row.suspectedFalseConfirmations) {
      if (!rawFc || typeof rawFc !== "object") continue;
      const fc = rawFc as Record<string, unknown>;
      const fieldId = asString(fc.fieldId);
      if (!fieldId) continue;
      suspectedFalseConfirmations.push({
        fieldId,
        itemKey: asString(fc.itemKey),
        description: asString(fc.description),
      });
    }
  }

  const isEmpty =
    verdicts.length === 0 &&
    missingMandatoryEvidenceFieldIds.length === 0 &&
    suspectedFalseConfirmations.length === 0;
  if (isEmpty) return null;

  return { verdicts, missingMandatoryEvidenceFieldIds, suspectedFalseConfirmations };
}
