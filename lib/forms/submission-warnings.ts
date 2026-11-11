/**
 * Server-side run of the extended answer rules for the cleaner submit route.
 *
 * The submit route already rejects the core rules (required answers, required
 * uploads, minimum photos, device status) with its own collectors. This runs
 * collectFormErrors with `extended: true` on the same effective schema and
 * keeps only the rules the route did not enforce before (EXTENDED_FORM_RULES):
 *
 *  - ENFORCE_EXTENDED_FORM_VALIDATION = false → `warnings` to store on the
 *    submission as `data.__validationWarnings`; the submission is accepted.
 *  - true → `reject` with the same list.
 *
 * PURE: no database, no session.
 */
import {
  collectFormErrors,
  ENFORCE_EXTENDED_FORM_VALIDATION,
  EXTENDED_FORM_RULES,
  type FormErrorRule,
} from "./validate-submission";

export type SubmissionValidationWarning = {
  fieldId: string;
  label: string;
  sectionLabel?: string;
  rule: FormErrorRule;
  message: string;
};

export type ExtendedValidationInput = {
  schema: unknown;
  answers: Record<string, unknown>;
  /** fieldId → stored keys (duplicates are counted once, as the route does). */
  uploads: Record<string, string[]>;
  property: Record<string, unknown>;
  laundryReady?: boolean;
  requiredChecklistTicksBlockSubmit: boolean;
  noPhoto: { canUseNoPhoto: boolean; reasons: Record<string, { reasonCode: string } | undefined> };
};

export type ExtendedValidationOutcome = {
  violations: SubmissionValidationWarning[];
  /** What to store on the submission (empty when enforcing — it was rejected). */
  warnings: SubmissionValidationWarning[];
  reject: boolean;
  message: string;
};

export function collectExtendedViolations(input: ExtendedValidationInput): SubmissionValidationWarning[] {
  const uploadCounts = Object.fromEntries(
    Object.entries(input.uploads).map(([fieldId, keys]) => [fieldId, new Set(keys).size]),
  );
  return collectFormErrors(
    input.schema,
    input.answers,
    uploadCounts,
    input.property,
    input.laundryReady,
    input.requiredChecklistTicksBlockSubmit,
    input.noPhoto,
    { extended: true },
  )
    .filter((error): error is typeof error & { rule: FormErrorRule } => Boolean(error.rule && EXTENDED_FORM_RULES.has(error.rule)))
    .map((error) => ({
      fieldId: error.fieldId,
      label: error.label,
      ...(error.sectionLabel ? { sectionLabel: error.sectionLabel } : {}),
      rule: error.rule,
      message: error.message,
    }));
}

export function extendedValidationOutcome(
  input: ExtendedValidationInput,
  enforce: boolean = ENFORCE_EXTENDED_FORM_VALIDATION,
): ExtendedValidationOutcome {
  const violations = collectExtendedViolations(input);
  const message = violations.map((violation) => `${violation.label}: ${violation.message}`).join("; ");
  if (enforce && violations.length > 0) return { violations, warnings: [], reject: true, message };
  return { violations, warnings: violations, reject: false, message };
}

/** Read stored warnings back off a submission's data (tolerant of anything). */
export function readSubmissionWarnings(data: unknown): SubmissionValidationWarning[] {
  if (!data || typeof data !== "object") return [];
  const raw = (data as Record<string, unknown>).__validationWarnings;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.fieldId !== "string" || typeof row.message !== "string") return [];
    return [{
      fieldId: row.fieldId,
      label: typeof row.label === "string" ? row.label : row.fieldId,
      ...(typeof row.sectionLabel === "string" ? { sectionLabel: row.sectionLabel } : {}),
      rule: (typeof row.rule === "string" ? row.rule : "range") as FormErrorRule,
      message: row.message,
    }];
  });
}
