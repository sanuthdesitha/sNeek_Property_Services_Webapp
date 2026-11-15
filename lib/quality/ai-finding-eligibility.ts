/**
 * Why an AI photo finding cannot be approved, in words, for the inspection
 * record's AI photo review (board "QualityInspection"). Pure and display-only:
 * the approval route (app/api/qa/jobs/[id]/photo-review, POST "approve") stays
 * the authority and keeps every rule. These reasons mirror its refusals so a
 * person sees the reason on the finding instead of a refused request:
 *
 * - confidence below the review's minimum (proposedPhotoDeduction skips it);
 * - the field or photo already has a QA issue on the authoritative review
 *   ("A selected area or photo is already covered by a QA issue");
 * - that QA review already includes an approved photo deduction.
 *
 * AI findings are suggestions. Nothing here selects, approves or applies one.
 */
import type { ConfidenceBand } from "@/lib/ai/photo-review-policy";

export type FindingFacts = {
  id: string;
  fieldId: string;
  mediaId: string;
  confidence: number;
  confidenceBand?: ConfidenceBand;
};

export type FindingBlockContext = {
  minConfidence: number;
  coveredFieldIds: readonly string[];
  coveredMediaIds: readonly string[];
  /** The current analysis id, and analyses that already deducted from the authoritative QA review. */
  analysisId: string;
  deductedAnalysisIds: readonly string[];
};

/** The band a finding states, or the band its stored number falls in (older reviews have no band). */
export function findingBand(finding: Pick<FindingFacts, "confidence" | "confidenceBand">): ConfidenceBand {
  if (finding.confidenceBand) return finding.confidenceBand;
  if (finding.confidence >= 0.9) return "high";
  if (finding.confidence >= 0.7) return "medium";
  return "low";
}

/** A sentence saying why this finding cannot be approved, or null when it can be selected. */
export function findingBlockReason(finding: FindingFacts, context: FindingBlockContext): string | null {
  if (context.deductedAnalysisIds.some((id) => id !== context.analysisId)) {
    return "this QA review already includes an approved photo deduction, so change it in the QA review instead";
  }
  if (context.coveredFieldIds.includes(finding.fieldId) || context.coveredMediaIds.includes(finding.mediaId)) {
    return "this area already has a QA finding, so change it in the QA review instead";
  }
  if (!Number.isFinite(finding.confidence) || finding.confidence < context.minConfidence) {
    return "below the deduction threshold, cannot be approved";
  }
  return null;
}
