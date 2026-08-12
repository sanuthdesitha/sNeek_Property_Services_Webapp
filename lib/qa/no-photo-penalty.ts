// QA penalty for sanctioned "no photo taken" waivers.
//
// Every field the cleaner waived counts as a SCORED MISS in the QA result:
// the field's points are added to the achievable maximum with zero earned, so
// the percentage drops in proportion to the points assigned to that field.
// Points come from the cleaner-form field's `noPhotoPenalty` when the builder
// set one, else DEFAULT_NO_PHOTO_PENALTY_POINTS (the weight of one standard
// Pass/Minor/Fail question).

import { flattenFieldsOneLevel } from "@/lib/forms/visibility";
import { sanitizeNoPhotoReasons, noPhotoReasonLabel } from "@/lib/forms/no-photo-reasons";

export const DEFAULT_NO_PHOTO_PENALTY_POINTS = 2;

export type QaScorePenalty = { points: number; label: string };

export function buildNoPhotoPenalties(submissionData: unknown): QaScorePenalty[] {
  const data =
    submissionData && typeof submissionData === "object"
      ? (submissionData as Record<string, unknown>)
      : {};
  const reasons = sanitizeNoPhotoReasons(data.__noPhotoReasons);
  const fieldIds = Object.keys(reasons);
  if (fieldIds.length === 0) return [];

  // Look the fields up in the snapshot schema for their label + assigned points.
  const schema = data.__templateSchema as { sections?: unknown[] } | undefined;
  const fieldById = new Map<string, Record<string, unknown>>();
  for (const section of Array.isArray(schema?.sections) ? schema!.sections! : []) {
    const fields = flattenFieldsOneLevel(
      Array.isArray((section as { fields?: unknown[] })?.fields)
        ? ((section as { fields?: unknown[] }).fields as unknown[])
        : []
    );
    for (const field of fields) {
      const id = (field as { id?: unknown })?.id;
      if (typeof id === "string" && id) fieldById.set(id, field as Record<string, unknown>);
    }
  }

  return fieldIds.map((fieldId) => {
    const field = fieldById.get(fieldId);
    const assigned = Number(field?.noPhotoPenalty);
    const points =
      Number.isFinite(assigned) && assigned > 0 ? assigned : DEFAULT_NO_PHOTO_PENALTY_POINTS;
    const label =
      typeof field?.label === "string" && field.label.trim()
        ? `${field.label.trim()} — no photo (${noPhotoReasonLabel(reasons[fieldId].reasonCode)})`
        : `${fieldId} — no photo`;
    return { points, label };
  });
}
