import "server-only";
import { db } from "@/lib/db";
import { parsePhotoReviewResult } from "./photo-review-policy";
import { visionSettingsSchema } from "./vision-settings-schema";

/**
 * "Agreement with inspectors": evaluation labels taken from every reviewer
 * decision already stored on AiPhotoReview (approve with selected findings, or
 * dismiss). Per provider and model:
 *  - confirmed: a finding the reviewer selected in an approved deduction;
 *  - not selected: a finding left out of an approved deduction;
 *  - dismissed: a finding in a review whose suggestions were dismissed.
 * Agreement = confirmed / all labelled findings. It measures how often the
 * AI's suggestions were accepted, not issues the AI missed (no label exists
 * for those), so it is shown with the cannot-tell and not-checked counts.
 */
export type AgreementRow = {
  provider: string;
  model: string;
  reviews: number;
  photos: number;
  cannotTell: number;
  notChecked: number;
  findings: number;
  confirmed: number;
  notSelected: number;
  dismissed: number;
  /** null when no finding has a label yet (never 0% or 100% by default). */
  agreement: number | null;
};

export type AgreementReport = { since: string; rows: AgreementRow[]; skipped: number };

export async function getPhotoReviewAgreement(now = new Date(), days = 90): Promise<AgreementReport> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const reviews = await db.aiPhotoReview.findMany({
    where: { reviewedAt: { gte: since } },
    orderBy: { reviewedAt: "desc" },
    take: 5000,
    select: { settings: true, result: true, decision: true },
  });
  const rows = new Map<string, AgreementRow>();
  let skipped = 0;
  for (const review of reviews) {
    const settings = visionSettingsSchema.safeParse(review.settings);
    const decision = review.decision as { action?: unknown; findingIds?: unknown } | null;
    let result;
    try { result = review.result ? parsePhotoReviewResult(review.result) : null; } catch { result = null; }
    if (!settings.success || !result || (decision?.action !== "approve" && decision?.action !== "dismiss")) { skipped++; continue; }
    const provider = settings.data.snapshotRoute?.provider ?? settings.data.provider;
    const model = settings.data.snapshotRoute?.model ?? settings.data.model;
    const key = JSON.stringify([provider, model]);
    const row = rows.get(key) ?? { provider, model, reviews: 0, photos: 0, cannotTell: 0, notChecked: 0, findings: 0, confirmed: 0, notSelected: 0, dismissed: 0, agreement: null };
    row.reviews++;
    row.photos += result.observations.length;
    row.cannotTell += result.observations.filter((observation) => observation.assessment === "inconclusive").length;
    row.notChecked += result.observations.filter((observation) => observation.assessment === "skipped").length;
    const findings = result.observations.flatMap((observation) => observation.findings);
    const selected = new Set(Array.isArray(decision.findingIds) ? decision.findingIds.filter((id): id is string => typeof id === "string") : []);
    row.findings += findings.length;
    for (const finding of findings) {
      if (decision.action === "dismiss") row.dismissed++;
      else if (selected.has(finding.id)) row.confirmed++;
      else row.notSelected++;
    }
    rows.set(key, row);
  }
  for (const row of Array.from(rows.values())) {
    const labelled = row.confirmed + row.notSelected + row.dismissed;
    row.agreement = labelled > 0 ? row.confirmed / labelled : null;
  }
  return { since: since.toISOString(), rows: Array.from(rows.values()).sort((a, b) => b.reviews - a.reviews), skipped };
}
