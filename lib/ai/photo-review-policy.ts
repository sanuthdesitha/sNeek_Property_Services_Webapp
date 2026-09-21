import { z } from "zod";
export type PhotoFinding = {
  id: string; mediaId: string; fieldId: string; fieldLabel: string;
  description: string; severity: "minor" | "major"; confidence: number;
};
export type PhotoObservation = {
  mediaId: string; fieldId: string; fieldLabel: string;
  assessment: "pass" | "issue" | "inconclusive" | "skipped";
  summary: string; findings: PhotoFinding[];
};
export type PhotoReviewResult = { observations: PhotoObservation[]; totalPhotos: number };

/** Multiple angles of one field cannot multiply the deduction for the same area. */
export function proposedPhotoDeduction(findings: PhotoFinding[], selectedIds: string[], minConfidence: number, cap: number) {
  const selected = new Set(selectedIds);
  const perField = new Map<string, number>();
  for (const finding of findings) {
    if (!selected.has(finding.id) || finding.confidence < minConfidence || !Number.isFinite(finding.confidence)) continue;
    const points = finding.severity === "major" ? 5 : 2;
    perField.set(finding.fieldId, Math.max(perField.get(finding.fieldId) ?? 0, points));
  }
  return Math.min(Math.max(0, Math.min(20, cap)), Array.from(perField.values()).reduce((a, b) => a + b, 0));
}

const findingSchema = z.object({ id: z.string().min(1), mediaId: z.string().min(1), fieldId: z.string().min(1), fieldLabel: z.string(), description: z.string(), severity: z.enum(["minor", "major"]), confidence: z.number().finite().min(0).max(1) });
const resultSchema = z.object({ totalPhotos: z.number().int().nonnegative(), observations: z.array(z.object({ mediaId: z.string().min(1), fieldId: z.string().min(1), fieldLabel: z.string(), assessment: z.enum(["pass", "issue", "inconclusive", "skipped"]), summary: z.string(), findings: z.array(findingSchema) })) });
export function parsePhotoReviewResult(value: unknown): PhotoReviewResult {
  const result = resultSchema.parse(value);
  const ids = new Set<string>(); const findings = new Set<string>();
  if (result.observations.length > result.totalPhotos) throw new Error("Invalid analysis results.");
  for (const observation of result.observations) {
    if (ids.has(observation.mediaId) || (observation.assessment !== "issue" && observation.findings.length > 0) || (observation.assessment === "issue" && !observation.findings.length)) throw new Error("Invalid analysis results.");
    ids.add(observation.mediaId);
    for (const finding of observation.findings) {
      if (findings.has(finding.id) || finding.mediaId !== observation.mediaId || finding.fieldId !== observation.fieldId) throw new Error("Invalid analysis results.");
      findings.add(finding.id);
    }
  }
  return result;
}
