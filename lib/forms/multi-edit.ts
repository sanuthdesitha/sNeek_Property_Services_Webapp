/**
 * Editing several questions together ("Editing N questions together").
 *
 * - Only properties valid for EVERY selected question type are offered
 *   (a photo minimum is not offered when a yes/no is selected too).
 * - A property whose values differ is shown as "Mixed".
 * - Applying writes ONLY the properties the admin changed; everything else
 *   keeps each question's own value.
 *
 * PURE: no React.
 */
import { getFieldTypeDef } from "./field-types";
import type { FieldFrequency, FormCondition, FormField, FormSchema } from "./types";

export type MultiEditKey =
  | "required"
  | "minPhotos"
  | "maxFiles"
  | "frequency"
  | "conditional"
  | "locationTag"
  | "severity"
  | "evidenceCategory"
  | "scoring"
  | "showExampleOnTick"
  | "stampTag";

/** The value shape each multi-edit property takes. */
export type MultiEditValue = {
  required: boolean;
  minPhotos: number | undefined;
  maxFiles: number | undefined;
  /** Cadence: "every" (each clean) or a number N (every Nth clean). */
  frequency: Cadence;
  conditional: FormCondition | undefined;
  locationTag: string | undefined;
  severity: FormField["severity"];
  evidenceCategory: string | undefined;
  /** Counts toward QA score. */
  scoring: boolean;
  showExampleOnTick: boolean;
  stampTag: string | undefined;
};

export type MultiEditPatch = Partial<MultiEditValue>;

/** "every" clean, "monthly" (first clean of each calendar month), every Nth clean, or "conditional" (checklist exception). */
export type Cadence = "every" | "conditional" | "monthly" | number;

export type SharedValue<K extends MultiEditKey> = { mixed: true } | { mixed: false; value: MultiEditValue[K] };

function isUpload(field: FormField): boolean {
  return Boolean(getFieldTypeDef(field.type)?.isUpload);
}

function isReadOnly(field: FormField): boolean {
  return Boolean(getFieldTypeDef(field.type)?.isReadOnly);
}

/** Whether a property applies to one question. */
export function keyAppliesTo(key: MultiEditKey, field: FormField): boolean {
  switch (key) {
    case "required":
    case "frequency":
      return !isReadOnly(field);
    case "minPhotos":
      return isUpload(field) && field.type !== "video";
    case "maxFiles":
    case "stampTag":
      return isUpload(field);
    case "scoring":
      return Boolean(getFieldTypeDef(field.type)?.scorable);
    case "showExampleOnTick":
      return Array.isArray(field.references) && field.references.length > 0;
    default:
      return true;
  }
}

export const MULTI_EDIT_ORDER: MultiEditKey[] = [
  "required",
  "minPhotos",
  "maxFiles",
  "frequency",
  "conditional",
  "locationTag",
  "severity",
  "evidenceCategory",
  "stampTag",
  "scoring",
  "showExampleOnTick",
];

/** Properties valid for every selected question. */
export function multiEditKeysFor(fields: readonly FormField[]): MultiEditKey[] {
  if (fields.length === 0) return [];
  return MULTI_EDIT_ORDER.filter((key) => fields.every((field) => keyAppliesTo(key, field)));
}

export function cadenceOf(field: FormField): Cadence {
  if (field.frequency === "ROTATIONAL") return field.rotationEveryNCleans ?? 4;
  if (field.frequency === "CONDITIONAL") return "conditional";
  if (field.frequency === "MONTHLY") return "monthly";
  return "every";
}

/** Read one property off a question in its multi-edit shape. */
export function readKey<K extends MultiEditKey>(field: FormField, key: K): MultiEditValue[K] {
  const read: { [P in MultiEditKey]: (f: FormField) => MultiEditValue[P] } = {
    required: (f) => Boolean(f.required),
    minPhotos: (f) => f.minPhotos,
    maxFiles: (f) => f.maxFiles,
    frequency: cadenceOf,
    conditional: (f) => f.conditional,
    locationTag: (f) => f.locationTag,
    severity: (f) => f.severity,
    evidenceCategory: (f) => f.evidenceCategory,
    scoring: (f) => Boolean(f.scoring),
    showExampleOnTick: (f) => f.showExampleOnTick !== false,
    stampTag: (f) => f.stampTag,
  };
  return read[key](field) as MultiEditValue[K];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function sharedValue<K extends MultiEditKey>(fields: readonly FormField[], key: K): SharedValue<K> {
  if (fields.length === 0) return { mixed: true };
  const first = readKey(fields[0], key);
  return fields.every((field) => sameValue(readKey(field, key), first)) ? { mixed: false, value: first } : { mixed: true };
}

function setOptional<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined || value === null || value === "") delete target[key];
  else target[key] = value;
}

function applyCadence(field: FormField, cadence: Cadence): FormField {
  const next = { ...field };
  if (cadence === "every") {
    delete next.frequency;
    delete next.rotationEveryNCleans;
  } else if (cadence === "conditional") {
    next.frequency = "CONDITIONAL" as FieldFrequency;
    delete next.rotationEveryNCleans;
  } else if (cadence === "monthly") {
    next.frequency = "MONTHLY";
    delete next.rotationEveryNCleans;
  } else {
    next.frequency = "ROTATIONAL";
    next.rotationEveryNCleans = cadence;
  }
  return next;
}

/** Apply a patch to one question (only keys present in the patch, only where valid). */
export function applyPatchToField(field: FormField, patch: MultiEditPatch): FormField {
  let next: FormField = { ...field };
  for (const key of Object.keys(patch) as MultiEditKey[]) {
    if (!keyAppliesTo(key, field)) continue;
    const value = patch[key];
    switch (key) {
      case "required":
        setOptional(next, "required", value ? true : undefined);
        break;
      case "minPhotos":
        setOptional(next, "minPhotos", value as number | undefined);
        break;
      case "maxFiles":
        setOptional(next, "maxFiles", value as number | undefined);
        break;
      case "frequency":
        next = applyCadence(next, value as Cadence);
        break;
      case "conditional":
        setOptional(next, "conditional", value as FormCondition | undefined);
        break;
      case "locationTag":
        setOptional(next, "locationTag", value as string | undefined);
        break;
      case "severity":
        setOptional(next, "severity", value as FormField["severity"]);
        break;
      case "evidenceCategory":
        setOptional(next, "evidenceCategory", value as string | undefined);
        break;
      case "stampTag":
        setOptional(next, "stampTag", value as string | undefined);
        break;
      case "scoring":
        if (value) next.scoring = field.scoring ?? { weight: 1, max: 1 };
        else delete next.scoring;
        break;
      case "showExampleOnTick":
        setOptional(next, "showExampleOnTick", value ? undefined : false);
        break;
    }
  }
  return next;
}

/** Apply a multi-edit patch to the selected questions of a schema. */
export function applyMultiEdit(schema: FormSchema, fieldIds: readonly string[], patch: MultiEditPatch): FormSchema {
  if (Object.keys(patch).length === 0) return schema;
  const wanted = new Set(fieldIds);
  return {
    ...schema,
    sections: schema.sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (wanted.has(field.id) ? applyPatchToField(field, patch) : field)),
    })),
  };
}
