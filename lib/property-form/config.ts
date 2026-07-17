// Property intake form configuration — an admin-editable layer over the typed
// property create form. The DEFINITIONS live in the `propertyFormConfig`
// AppSetting; custom-field VALUES live in Property.customFields. The typed form
// itself is unchanged — this config only decides which system fields are
// required/hidden/conditional and which extra custom fields exist.
//
// Conditional evaluation reuses the forms engine (`isTemplateConditionalMet`)
// so the rule semantics match the checklist/job forms exactly.

import { db } from "@/lib/db";
import { isTemplateConditionalMet } from "@/lib/forms/visibility";
import type { FieldCondition } from "@/lib/forms/types";
import {
  PROPERTY_SYSTEM_FIELD_MAP,
  isKnownSystemField,
} from "./fields";

export const PROPERTY_FORM_CONFIG_KEY = "propertyFormConfig";

/** Custom field types the property intake supports (subset of the forms engine). */
export const CUSTOM_FIELD_TYPES = [
  "text",
  "longtext",
  "number",
  "select",
  "yesno",
  "photo",
  "file",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface SystemFieldOverride {
  required?: boolean;
  hidden?: boolean;
  order?: number;
  conditional?: FieldCondition;
}

export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  options?: string[];
  helpText?: string;
  placeholder?: string;
  conditional?: FieldCondition;
}

export interface PropertyFormConfig {
  version: 1;
  systemFields: Record<string, SystemFieldOverride>;
  customFields: CustomFieldDef[];
}

export const EMPTY_PROPERTY_FORM_CONFIG: PropertyFormConfig = {
  version: 1,
  systemFields: {},
  customFields: [],
};

/** True for the media custom-field types that store an { url, key } value. */
export function isUploadCustomField(type: CustomFieldType): boolean {
  return type === "photo" || type === "file";
}

// ── Sanitisation ─────────────────────────────────────────────────────────────

function sanitizeCondition(input: unknown): FieldCondition | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const fieldId = typeof raw.fieldId === "string" ? raw.fieldId.trim() : "";
  if (!fieldId) return undefined;
  const operator =
    typeof raw.operator === "string" &&
    ["equals", "notEquals", "answered", "notAnswered", "oneOf", "gt", "lt"].includes(raw.operator)
      ? (raw.operator as FieldCondition["operator"])
      : "equals";
  const cond: FieldCondition = { fieldId, operator };
  if ("value" in raw) cond.value = raw.value;
  return cond;
}

function sanitizeSystemOverride(input: unknown): SystemFieldOverride {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: SystemFieldOverride = {};
  if (typeof raw.required === "boolean") out.required = raw.required;
  if (typeof raw.hidden === "boolean") out.hidden = raw.hidden;
  if (typeof raw.order === "number" && Number.isFinite(raw.order)) out.order = raw.order;
  const cond = sanitizeCondition(raw.conditional);
  if (cond) out.conditional = cond;
  return out;
}

function sanitizeCustomField(input: unknown): CustomFieldDef | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  const type = CUSTOM_FIELD_TYPES.includes(raw.type as CustomFieldType)
    ? (raw.type as CustomFieldType)
    : "text";
  if (!id || !label) return null;
  const field: CustomFieldDef = { id, label, type };
  if (typeof raw.required === "boolean") field.required = raw.required;
  if (typeof raw.helpText === "string" && raw.helpText.trim()) field.helpText = raw.helpText.trim().slice(0, 500);
  if (typeof raw.placeholder === "string" && raw.placeholder.trim())
    field.placeholder = raw.placeholder.trim().slice(0, 200);
  if (type === "select" && Array.isArray(raw.options)) {
    field.options = raw.options
      .filter((o): o is string => typeof o === "string")
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 60);
  }
  const cond = sanitizeCondition(raw.conditional);
  if (cond) field.conditional = cond;
  return field;
}

/** Normalise any stored/submitted config blob into a safe PropertyFormConfig. */
export function sanitizePropertyFormConfig(input: unknown): PropertyFormConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const systemFields: Record<string, SystemFieldOverride> = {};
  const rawSystem = raw.systemFields;
  if (rawSystem && typeof rawSystem === "object" && !Array.isArray(rawSystem)) {
    for (const [id, value] of Object.entries(rawSystem as Record<string, unknown>)) {
      if (!isKnownSystemField(id)) continue;
      const def = PROPERTY_SYSTEM_FIELD_MAP[id];
      const ov = sanitizeSystemOverride(value);
      // Locked core fields can never be hidden or non-required.
      if (def.locked) {
        delete ov.hidden;
        delete ov.required;
      }
      if (!def.supportsRequired) delete ov.required;
      systemFields[id] = ov;
    }
  }

  const seen = new Set<string>();
  const customFields: CustomFieldDef[] = [];
  const rawCustom = Array.isArray(raw.customFields) ? raw.customFields : [];
  for (const entry of rawCustom.slice(0, 60)) {
    const field = sanitizeCustomField(entry);
    if (!field || seen.has(field.id)) continue;
    seen.add(field.id);
    customFields.push(field);
  }

  return { version: 1, systemFields, customFields };
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function getPropertyFormConfig(): Promise<PropertyFormConfig> {
  const row = await db.appSetting.findUnique({ where: { key: PROPERTY_FORM_CONFIG_KEY } });
  if (!row?.value) return EMPTY_PROPERTY_FORM_CONFIG;
  return sanitizePropertyFormConfig(row.value);
}

export async function savePropertyFormConfig(input: unknown): Promise<PropertyFormConfig> {
  const config = sanitizePropertyFormConfig(input);
  await db.appSetting.upsert({
    where: { key: PROPERTY_FORM_CONFIG_KEY },
    create: { key: PROPERTY_FORM_CONFIG_KEY, value: config as any },
    update: { value: config as any },
  });
  return config;
}

// ── Evaluation (shared by client + server) ───────────────────────────────────

/**
 * Evaluate a field's `conditional` against the current form values. Values are
 * keyed by field id (system + custom). Reuses the forms-engine evaluator so the
 * operator semantics match the checklist forms.
 */
export function conditionMet(
  conditional: FieldCondition | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!conditional) return true;
  return isTemplateConditionalMet(conditional, values, {});
}

export function isSystemFieldHidden(id: string, config: PropertyFormConfig): boolean {
  const def = PROPERTY_SYSTEM_FIELD_MAP[id];
  if (def?.locked) return false;
  return config.systemFields[id]?.hidden === true;
}

export function isSystemFieldVisible(
  id: string,
  config: PropertyFormConfig,
  values: Record<string, unknown>,
): boolean {
  if (isSystemFieldHidden(id, config)) return false;
  return conditionMet(config.systemFields[id]?.conditional, values);
}

/** Whether a system field must be filled given the config + current values. */
export function getEffectiveRequired(
  id: string,
  config: PropertyFormConfig,
  values: Record<string, unknown>,
): boolean {
  const def = PROPERTY_SYSTEM_FIELD_MAP[id];
  if (!def) return false;
  if (def.locked) return true;
  if (!def.supportsRequired) return false;
  if (!isSystemFieldVisible(id, config, values)) return false;
  const ov = config.systemFields[id];
  if (ov?.required === true) return true;
  if (ov?.required === false) return false;
  return def.defaultRequired === true;
}

export function isCustomFieldVisible(
  field: CustomFieldDef,
  values: Record<string, unknown>,
): boolean {
  return conditionMet(field.conditional, values);
}

export function isCustomFieldRequired(
  field: CustomFieldDef,
  values: Record<string, unknown>,
): boolean {
  return field.required === true && isCustomFieldVisible(field, values);
}

function isBlank(value: unknown): boolean {
  return (
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0)
  );
}

export interface MissingField {
  id: string;
  label: string;
}

/**
 * Server-side validation mirror: given the config, the system-field values, and
 * the custom-field values, return the labels of every visible-and-required
 * field left blank. Locked fields are validated by zod already but are included
 * here for completeness.
 */
export function collectMissingRequired(
  config: PropertyFormConfig,
  systemValues: Record<string, unknown>,
  customValues: Record<string, unknown>,
): MissingField[] {
  const values = { ...systemValues, ...customValues };
  const missing: MissingField[] = [];

  for (const def of Object.values(PROPERTY_SYSTEM_FIELD_MAP)) {
    if (!def.supportsRequired) continue;
    if (!getEffectiveRequired(def.id, config, values)) continue;
    if (isBlank(systemValues[def.id])) missing.push({ id: def.id, label: def.label });
  }

  for (const field of config.customFields) {
    if (!isCustomFieldRequired(field, values)) continue;
    if (isBlank(customValues[field.id])) missing.push({ id: field.id, label: field.label });
  }

  return missing;
}

/**
 * Keep only custom-field values whose field still exists AND is visible under
 * the current values — a hidden/failed-condition field never persists a value.
 */
export function pruneCustomValues(
  config: PropertyFormConfig,
  systemValues: Record<string, unknown>,
  customValues: Record<string, unknown>,
): Record<string, unknown> {
  const values = { ...systemValues, ...customValues };
  const out: Record<string, unknown> = {};
  for (const field of config.customFields) {
    if (!isCustomFieldVisible(field, values)) continue;
    const value = customValues[field.id];
    if (isBlank(value)) continue;
    out[field.id] = value;
  }
  return out;
}
