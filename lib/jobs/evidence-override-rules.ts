/**
 * "Camera not working — ask the office" (cleaner job flow v2, item 2): the
 * shared shapes and limits. Plain module: the cleaner screen, the office
 * card, the routes and tests share it.
 *
 * A cleaner asks to submit one job without specific missing photos, with a
 * reason. An ADMIN or OPS_MANAGER allows some or all of those questions (a
 * reason is required) or declines (a reason is required). Only the allowed
 * questions are waived, only on that job; every other check stays.
 */
import { isUploadFieldType } from "@/lib/forms/field-types";
import { flattenFieldsOneLevel } from "@/lib/forms/visibility";

export const EVIDENCE_OVERRIDE_NOTE_MAX = 1000;
export const EVIDENCE_OVERRIDE_REASON_MIN = 5;
export const EVIDENCE_OVERRIDE_FIELDS_MAX = 60;

export type EvidenceOverrideStatus = "REQUESTED" | "ALLOWED" | "DECLINED";

export const EVIDENCE_OVERRIDE_STATUS_LABELS: Record<EvidenceOverrideStatus, string> = {
  REQUESTED: "Waiting for the office",
  ALLOWED: "Allowed by the office",
  DECLINED: "Declined by the office",
};

export type EvidenceOverrideField = { fieldId: string; label: string };

/** One request as the cleaner sees it (no office identities). */
export type EvidenceOverrideCleanerView = {
  id: string;
  status: EvidenceOverrideStatus;
  note: string;
  fields: EvidenceOverrideField[];
  allowedFieldIds: string[];
  decisionReason: string | null;
  askedAt: string;
  decidedAt: string | null;
};

/** One request as the office sees it on the job page. */
export type EvidenceOverrideOfficeView = EvidenceOverrideCleanerView & {
  requestedByName: string;
  decidedByName: string | null;
  decidedByRole: string | null;
};

export type EvidenceOverrideCleanerPayload = {
  jobId: string;
  requests: EvidenceOverrideCleanerView[];
  /** Every question the office has allowed on this job (union of allowed requests). */
  allowedFieldIds: string[];
  canAsk: boolean;
  refusal: string | null;
  timeZone: string;
};

/** Pair stored ids with stored labels (labels may be missing on hand-edited rows). */
export function pairFields(fieldIds: readonly string[], fieldLabels: readonly string[]): EvidenceOverrideField[] {
  return fieldIds.map((fieldId, index) => ({ fieldId, label: fieldLabels[index]?.trim() || fieldId }));
}

/** Union of the allowed questions of every ALLOWED request. */
export function allowedFieldsOf(rows: ReadonlyArray<{ status: string; allowedFieldIds: readonly string[] }>): string[] {
  const allowed = new Set<string>();
  for (const row of rows) {
    if (row.status !== "ALLOWED") continue;
    for (const fieldId of row.allowedFieldIds) allowed.add(fieldId);
  }
  return Array.from(allowed).sort();
}

type BlockerLike = { fieldId: string; rule?: string };

/**
 * Remove the blockers the office waived: only missing-upload blockers of the
 * allowed questions (a wrong answer elsewhere is never waived).
 */
export function withoutAllowedUploads<T extends BlockerLike>(errors: readonly T[], allowedFieldIds: readonly string[], uploadFieldIds: ReadonlySet<string>): T[] {
  if (allowedFieldIds.length === 0) return [...errors];
  const allowed = new Set(allowedFieldIds);
  return errors.filter((error) => !(allowed.has(error.fieldId) && uploadFieldIds.has(error.fieldId)));
}

type SchemaLike = { sections?: Array<{ fields?: unknown[] }> } | null | undefined;

/** Ids of the form's photo / video / file questions (one level of children, as the renderer shows them). */
export function uploadFieldIdsOf(schema: SchemaLike): Set<string> {
  const ids = new Set<string>();
  for (const section of Array.isArray(schema?.sections) ? schema!.sections : []) {
    const fields: Array<{ id?: unknown; type?: unknown }> = flattenFieldsOneLevel(section?.fields);
    for (const field of fields) {
      if (isUploadFieldType(field?.type)) ids.add(String(field.id));
    }
  }
  return ids;
}

/** The allowed questions from the job form payload (`evidenceOverride.allowedFieldIds`); anything unreadable = none. */
export function officeAllowedFieldIds(payload: unknown): string[] {
  const value = (payload as { evidenceOverride?: { allowedFieldIds?: unknown } } | null | undefined)?.evidenceOverride?.allowedFieldIds;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
