// Suggested QA score from the cleaner's own submission.
//
// Purpose: an admin closing out jobs that never got a real inspection should
// not have to invent a number. This reads what the cleaner actually submitted —
// unanswered required fields, unticked checklist items, missing photos,
// sanctioned no-photo waivers, incomplete tasks, an incomplete self-inspection —
// and proposes a score with an itemised reason for every deduction, so the
// admin can bulk-approve the obvious ones and only think about the outliers.
//
// PURE: no DB, no I/O, no clock. The caller supplies the submission row. The
// same function powers the admin suggestion UI and the 24h auto-scorer, so the
// number an admin sees is exactly the number automation would apply.

import { flattenFieldsOneLevel, isFlattenedFieldVisible, isTemplateNodeVisible } from "@/lib/forms/visibility";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { sanitizeNoPhotoReasons, noPhotoReasonLabel } from "@/lib/forms/no-photo-reasons";

/** One itemised reason the suggestion is below 100. */
export type SuggestedScoreFactor = {
  /** Machine key for grouping/telemetry, e.g. "missing_photos". */
  code:
    | "unanswered_required"
    | "unticked_checklist"
    | "missing_photos"
    | "no_photo_waiver"
    | "self_inspection_incomplete"
    | "task_not_completed"
    | "admin_task_incomplete";
  label: string;
  /** Points deducted (positive number). */
  penalty: number;
  count: number;
};

export type SuggestedScore = {
  /** 0-100, rounded. */
  score: number;
  factors: SuggestedScoreFactor[];
  /** One-line rationale for the UI. */
  summary: string;
  /** True when nothing was deducted — the safe bulk-approve case. */
  clean: boolean;
};

// Per-occurrence deductions. Deliberately gentle: this proposes a score for a
// clean nobody inspected, so it must not manufacture failures out of small
// paperwork gaps — but a pattern of them still lands below the pass threshold.
const PENALTY = {
  unanswered_required: 4,
  unticked_checklist: 2,
  missing_photos: 5,
  no_photo_waiver: 5,
  self_inspection_incomplete: 3,
  task_not_completed: 8,
  admin_task_incomplete: 8,
} as const;

/** Cap per factor so one noisy category can't alone zero the score. */
const FACTOR_CAP = 30;

function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

export type SuggestedScoreInput = {
  /** FormSubmission.data (must contain __templateSchema for a full read). */
  data: unknown;
  /** SubmissionMedia rows for the submission: [{ fieldId }]. */
  media?: Array<{ fieldId?: string | null }>;
  /** Property row — drives conditional field visibility (hasBalcony etc). */
  property?: Record<string, unknown>;
};

/**
 * Propose a QA score for a submission. Returns 100 with `clean: true` when the
 * cleaner left nothing outstanding.
 */
export function suggestQaScore(input: SuggestedScoreInput): SuggestedScore {
  const data =
    input.data && typeof input.data === "object" ? (input.data as Record<string, unknown>) : {};
  const property = input.property ?? {};
  const schema = data.__templateSchema as { sections?: unknown[] } | undefined;
  const sections = Array.isArray(schema?.sections) ? schema!.sections! : [];

  // fieldId → committed media count (uploads map first, media rows as fallback).
  const uploadsRaw =
    data.uploads && typeof data.uploads === "object" ? (data.uploads as Record<string, unknown>) : {};
  const uploadCounts: Record<string, number> = {};
  for (const [fieldId, value] of Object.entries(uploadsRaw)) {
    uploadCounts[fieldId] = Array.isArray(value)
      ? value.filter((v) => typeof v === "string" && v.trim()).length
      : typeof value === "string" && value.trim()
        ? 1
        : 0;
  }
  for (const row of input.media ?? []) {
    const fieldId = typeof row?.fieldId === "string" ? row.fieldId : "";
    if (!fieldId) continue;
    uploadCounts[fieldId] = (uploadCounts[fieldId] ?? 0) + 1;
  }

  const noPhotoReasons = sanitizeNoPhotoReasons(data.__noPhotoReasons);

  let unansweredRequired = 0;
  let untickedChecklist = 0;
  let missingPhotos = 0;

  for (const section of sections as Array<Record<string, unknown>>) {
    if (!isTemplateNodeVisible(section as never, data, property)) continue;
    const fields = flattenFieldsOneLevel(
      Array.isArray((section as { fields?: unknown[] })?.fields)
        ? ((section as { fields?: unknown[] }).fields as unknown[])
        : []
    );
    for (const field of fields as Array<Record<string, unknown>>) {
      const fieldId = typeof field?.id === "string" ? field.id : "";
      if (!fieldId) continue;
      if (!isFlattenedFieldVisible(field, data, property)) continue;
      const type = typeof field.type === "string" ? field.type.toLowerCase() : "";
      const required = field.required === true;
      const value = data[fieldId];

      if (isUploadFieldType(type)) {
        // A sanctioned waiver is counted once, under its own factor — not here
        // as well, or the same gap is charged twice.
        if (noPhotoReasons[fieldId]) continue;
        const need = Math.max(required ? 1 : 0, Number(field.minPhotos ?? 0) || 0);
        if (need > 0 && (uploadCounts[fieldId] ?? 0) < need) missingPhotos += 1;
        continue;
      }

      if (type === "checkbox") {
        // Generated checklist items are checkbox+required; an unticked one is
        // the single most common gap, so it is scored gently and separately.
        if (required && value !== true) untickedChecklist += 1;
        continue;
      }

      if (type === "instruction" || type === "heading" || type === "divider") continue;
      if (required && isBlank(value)) unansweredRequired += 1;
    }
  }

  const noPhotoWaivers = Object.keys(noPhotoReasons).length;
  const selfInspectionIncomplete = Array.isArray(data.__selfInspectionIncomplete)
    ? data.__selfInspectionIncomplete.length
    : 0;
  const jobTasks = Array.isArray(data.__jobTasks) ? (data.__jobTasks as Array<Record<string, unknown>>) : [];
  const tasksNotCompleted = jobTasks.filter((t) => String(t?.decision ?? "") === "NOT_COMPLETED").length;
  const adminTasks = Array.isArray(data.__adminRequestedTasks)
    ? (data.__adminRequestedTasks as Array<Record<string, unknown>>)
    : [];
  const adminTasksIncomplete = adminTasks.filter((t) => t?.completed !== true).length;

  const factors: SuggestedScoreFactor[] = [];
  const add = (code: SuggestedScoreFactor["code"], count: number, label: string) => {
    if (count <= 0) return;
    factors.push({
      code,
      count,
      label,
      penalty: Math.min(FACTOR_CAP, count * PENALTY[code]),
    });
  };

  add(
    "task_not_completed",
    tasksNotCompleted,
    `${tasksNotCompleted} job task${tasksNotCompleted === 1 ? "" : "s"} not completed`
  );
  add(
    "admin_task_incomplete",
    adminTasksIncomplete,
    `${adminTasksIncomplete} admin-requested task${adminTasksIncomplete === 1 ? "" : "s"} incomplete`
  );
  add(
    "missing_photos",
    missingPhotos,
    `${missingPhotos} photo field${missingPhotos === 1 ? "" : "s"} missing required evidence`
  );
  add(
    "no_photo_waiver",
    noPhotoWaivers,
    noPhotoWaivers === 1
      ? `1 field waived with no photo (${noPhotoReasonLabel(Object.values(noPhotoReasons)[0]?.reasonCode)})`
      : `${noPhotoWaivers} fields waived with no photo`
  );
  add(
    "unanswered_required",
    unansweredRequired,
    `${unansweredRequired} required field${unansweredRequired === 1 ? "" : "s"} left blank`
  );
  add(
    "unticked_checklist",
    untickedChecklist,
    `${untickedChecklist} checklist item${untickedChecklist === 1 ? "" : "s"} left unticked`
  );
  add(
    "self_inspection_incomplete",
    selfInspectionIncomplete,
    `${selfInspectionIncomplete} self-inspection item${selfInspectionIncomplete === 1 ? "" : "s"} unticked at submission`
  );

  const totalPenalty = factors.reduce((sum, f) => sum + f.penalty, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  return {
    score,
    factors,
    clean: factors.length === 0,
    summary:
      factors.length === 0
        ? "Submission complete — nothing outstanding."
        : factors.map((f) => f.label).join("; "),
  };
}
