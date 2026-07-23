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

      // Blank = "not assessed / not applicable" — exclude the field entirely
      // (points AND max) rather than counting 0-of-max, mirroring the explicit
      // blank-exclusion the legacy rating path applies in lib/qa/templates.ts.
      // Without this, hiding/deriving the Pass/Minor/Fail control (or an N/A
      // verdict deleting the answer) would drag the stored percent toward 0.
      if (value === undefined || value === null || value === "") continue;

      let fieldPoints = 0;
      const isChoiceScore =
        (field.type === "radio" || field.type === "select") &&
        typeof value === "string" &&
        value in RADIO_SCORES;
      const isNumericScore =
        (field.type === "rating" ||
          field.type === "slider" ||
          field.type === "scale" ||
          field.type === "counter" ||
          field.type === "number") &&
        typeof value === "number" &&
        Number.isFinite(value);

      if (isChoiceScore) {
        fieldPoints = RADIO_SCORES[value as string] * weight;
      } else if (isNumericScore) {
        const clamped = Math.max(0, Math.min(value as number, field.scoring.max));
        fieldPoints = clamped * weight;
      } else if (field.type === "checkbox") {
        fieldPoints = value ? field.scoring.max * weight : 0;
      } else if (field.type === "yesno") {
        // Only an explicit "Yes" scores; "No" and "N/A" score zero. Accept the
        // string "true"/"yes" as well as boolean true — some submit paths
        // stringify yes/no values (see fmtBoolean in lib/forms/field-types.ts),
        // and those were previously scoring zero despite being a "Yes".
        const isYes =
          value === true ||
          (typeof value === "string" && ["true", "yes"].includes(value.trim().toLowerCase()));
        fieldPoints = isYes ? field.scoring.max * weight : 0;
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
