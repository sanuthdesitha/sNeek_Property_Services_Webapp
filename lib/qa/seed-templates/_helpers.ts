/**
 * Shared helpers for QA seed templates.
 *
 * QA inspection forms follow a consistent "Pass / Minor / Fail" radio + photo
 * evidence + notes section pattern. Each template ends with a standard "Overall"
 * section (rating + feedback + visibility flag + signature).
 *
 * Scoring contract (must match lib/qa/scoring.ts):
 *   - radio with options ["Pass", "Minor issues", "Fail"]: 2 / 1 / 0
 *   - rating (1-5): raw value
 *   - checkbox: 0 / max
 * Each field's `scoring.max` is the per-field cap; `weight` multiplies it.
 */
import type { JobType } from "@prisma/client";
import type { FormField, FormSchema, FormSection } from "@/lib/forms/types";

export const PASS_OPTIONS = ["Pass", "Minor issues", "Fail"] as const;

/**
 * Build a "Pass/Minor/Fail" radio field with scoring.
 * @param weight optional weight multiplier (default 1)
 */
export function passField(
  id: string,
  label: string,
  opts: { weight?: number; required?: boolean; helpText?: string } = {}
): FormField {
  return {
    id,
    type: "radio",
    label,
    options: [...PASS_OPTIONS],
    required: opts.required ?? true,
    helpText: opts.helpText,
    scoring: { weight: opts.weight ?? 1, max: 2 },
  };
}

/**
 * Standard photo evidence field for a QA section.
 */
export function photoField(id: string, label = "Photo evidence (1+ photos)", minPhotos = 1, required = true): FormField {
  return {
    id,
    type: "photo",
    label,
    minPhotos,
    required,
  };
}

/**
 * Standard inspector notes field.
 */
export function notesField(id: string, label = "Inspector notes (optional)"): FormField {
  return {
    id,
    type: "longtext",
    label,
  };
}

/**
 * Wrap a list of pass/fail field definitions into a section.
 * Appends standard photo + notes fields automatically.
 */
export function qaSection(
  id: string,
  title: string,
  passQuestions: Array<{ id: string; label: string; weight?: number }>,
  options: { photoMin?: number; description?: string } = {}
): FormSection {
  const fields: FormField[] = [
    ...passQuestions.map((q) => passField(`${id}-${q.id}`, q.label, { weight: q.weight })),
    photoField(`${id}-evidence`, "Photo evidence (1+ photos)", options.photoMin ?? 1),
    notesField(`${id}-notes`),
  ];
  return { id, title, description: options.description, fields };
}

/**
 * The mandatory final section every QA template ends with — overall rating,
 * cleaner feedback, client-visibility toggle, and inspector signature.
 */
export function finalSection(): FormSection {
  return {
    id: "final-rating",
    title: "Overall",
    fields: [
      {
        id: "overall-rating",
        type: "rating",
        label: "Overall job rating (1-5)",
        required: true,
        scoring: { weight: 5, max: 5 },
      },
      {
        id: "cleaner-feedback",
        type: "longtext",
        label: "Feedback for the cleaner",
        helpText: "Constructive notes — the cleaner will see this on their next job at this property.",
      },
      {
        id: "client-visible",
        type: "checkbox",
        label: "Share these notes with the client",
      },
      {
        id: "signature",
        type: "signature",
        label: "Inspector signature",
        required: true,
      },
    ],
  };
}

export interface QaSeedTemplate {
  name: string;
  serviceType: JobType;
  version: number;
  schema: FormSchema;
}

/**
 * Assemble a QA template from sections + auto-append the final section.
 */
export function buildQaTemplate(args: {
  name: string;
  serviceType: JobType;
  version?: number;
  sections: FormSection[];
}): QaSeedTemplate {
  return {
    name: args.name,
    serviceType: args.serviceType,
    version: args.version ?? 1,
    schema: { sections: [...args.sections, finalSection()] },
  };
}
