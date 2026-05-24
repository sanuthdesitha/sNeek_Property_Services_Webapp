/**
 * QA submission scoring engine.
 *
 * Inputs:
 *   - QA template (FormSchema shape from `lib/forms/types`)
 *   - submission answers (Record<fieldId, value>)
 *
 * Outputs total points, max points, percent, band (PASS / WARNING / FAIL),
 * and per-section breakdown.
 *
 * Scoring rules (must match `lib/qa/seed-templates/_helpers.ts`):
 *   - radio with options ["Pass", "Minor issues", "Fail"]: 2 / 1 / 0
 *   - rating (1-5): clamped 0..max, multiplied by weight
 *   - checkbox: max if true, 0 if false
 * Fields without `scoring` are ignored (e.g. photo, longtext, signature).
 *
 * Bands:
 *   >= 80%  → PASS
 *   >= 60%  → WARNING
 *   <  60%  → FAIL
 */
import type { FormSchema } from "@/lib/forms/types";

export const PASS_THRESHOLD = 80;
export const WARN_THRESHOLD = 60;

export type QaBand = "PASS" | "WARNING" | "FAIL";

export interface QaSectionScore {
  sectionId: string;
  title: string;
  percent: number;
  points: number;
  max: number;
}

export interface QaScoreResult {
  totalPoints: number;
  maxPoints: number;
  percent: number;
  band: QaBand;
  sectionScores: QaSectionScore[];
}

const RADIO_SCORES: Record<string, number> = {
  Pass: 2,
  "Minor issues": 1,
  Fail: 0,
};

export function computeQaScore(template: FormSchema, answers: Record<string, unknown>): QaScoreResult {
  let total = 0;
  let max = 0;
  const sectionScores: QaSectionScore[] = [];

  for (const section of template.sections ?? []) {
    let sectionPoints = 0;
    let sectionMax = 0;

    for (const field of section.fields ?? []) {
      if (!field.scoring) continue;
      const weight = field.scoring.weight ?? 1;
      const fieldMax = field.scoring.max * weight;
      const value = answers[field.id];

      let fieldPoints = 0;
      if (field.type === "radio" && typeof value === "string" && value in RADIO_SCORES) {
        fieldPoints = RADIO_SCORES[value] * weight;
      } else if (field.type === "rating" && typeof value === "number" && Number.isFinite(value)) {
        const clamped = Math.max(0, Math.min(value, field.scoring.max));
        fieldPoints = clamped * weight;
      } else if (field.type === "checkbox") {
        fieldPoints = value ? field.scoring.max * weight : 0;
      }

      sectionPoints += fieldPoints;
      sectionMax += fieldMax;
    }

    total += sectionPoints;
    max += sectionMax;

    if (sectionMax > 0) {
      sectionScores.push({
        sectionId: section.id,
        title: section.title,
        points: sectionPoints,
        max: sectionMax,
        percent: Math.round((sectionPoints / sectionMax) * 100),
      });
    }
  }

  const percent = max > 0 ? Math.round((total / max) * 100) : 0;
  const band: QaBand = percent >= PASS_THRESHOLD ? "PASS" : percent >= WARN_THRESHOLD ? "WARNING" : "FAIL";

  return { totalPoints: total, maxPoints: max, percent, band, sectionScores };
}
