/**
 * Property form editor (board "Property form", 2026-11-17): field states,
 * the list of unsaved changes shown in the bar, and the preview rows of the
 * new property form. PURE (plain module).
 */
import { PROPERTY_SYSTEM_FIELDS, PROPERTY_SYSTEM_FIELD_MAP, type PropertyFieldDef } from "@/lib/property-form/fields";
import type { CustomFieldDef, CustomFieldType, PropertyFormConfig, SystemFieldOverride } from "@/lib/property-form/config";
import type { FieldCondition } from "@/lib/forms/types";

export type SystemState = "required" | "optional" | "hidden";

export const STATE_LABEL: Record<SystemState, string> = { required: "Required", optional: "Optional", hidden: "Hidden" };

export const CUSTOM_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Short text",
  longtext: "Paragraph",
  number: "Number",
  select: "Dropdown",
  yesno: "Yes / No",
  photo: "Photo upload",
  file: "File upload",
};

export const GROUP_LABEL: Record<string, string> = {
  details: "Property details",
  access: "Access and instructions",
  quality: "Quality and accountability",
  notes: "Notes",
};

/** Rows shown in a group before "Show". */
export const GROUP_PREVIEW_ROWS = 6;

export function systemStateOf(def: PropertyFieldDef, override: SystemFieldOverride | undefined): SystemState {
  if (override?.hidden) return "hidden";
  if (!def.supportsRequired) return "optional";
  if (override?.required === true) return "required";
  if (override?.required === false) return "optional";
  return def.defaultRequired ? "required" : "optional";
}

export function overrideForState(state: SystemState, current: SystemFieldOverride | undefined): SystemFieldOverride {
  if (state === "hidden") return { ...current, hidden: true };
  if (state === "required") return { ...current, hidden: false, required: true };
  return { ...current, hidden: false, required: false };
}

function sameCondition(a: FieldCondition | undefined, b: FieldCondition | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function stateWord(def: PropertyFieldDef, state: SystemState): string {
  if (!def.supportsRequired) return state === "hidden" ? "Hidden" : "Shown";
  return STATE_LABEL[state];
}

export type FormChange = { key: string; text: string };

/** What differs between the saved config and the draft, in words, for the bar. */
export function describeChanges(saved: PropertyFormConfig, draft: PropertyFormConfig): FormChange[] {
  const changes: FormChange[] = [];
  for (const def of PROPERTY_SYSTEM_FIELDS) {
    if (def.locked) continue;
    const before = systemStateOf(def, saved.systemFields[def.id]);
    const after = systemStateOf(def, draft.systemFields[def.id]);
    if (before !== after) changes.push({ key: `state:${def.id}`, text: `${def.label}: ${stateWord(def, before)} → ${stateWord(def, after)}` });
    if (!sameCondition(saved.systemFields[def.id]?.conditional, draft.systemFields[def.id]?.conditional)) {
      changes.push({ key: `cond:${def.id}`, text: `${def.label}: condition ${draft.systemFields[def.id]?.conditional ? "changed" : "removed"}` });
    }
  }
  const savedById = new Map(saved.customFields.map((field) => [field.id, field]));
  const draftIds = new Set(draft.customFields.map((field) => field.id));
  draft.customFields.forEach((field, index) => {
    const before = savedById.get(field.id);
    const label = field.label.trim() || "Untitled field";
    if (!before) {
      changes.push({ key: `new:${field.id}`, text: `${label}: new custom field` });
      return;
    }
    if (JSON.stringify(before) !== JSON.stringify(field)) changes.push({ key: `edit:${field.id}`, text: `${label}: custom field changed` });
    else if (saved.customFields.findIndex((row) => row.id === field.id) !== index) changes.push({ key: `move:${field.id}`, text: `${label}: moved` });
  });
  for (const field of saved.customFields) {
    if (!draftIds.has(field.id)) changes.push({ key: `del:${field.id}`, text: `${field.label}: custom field deleted` });
  }
  return changes;
}

/** Whether a system field row differs from the saved config (it is tinted and labelled "Changed"). */
export function systemFieldChanged(id: string, saved: PropertyFormConfig, draft: PropertyFormConfig): boolean {
  const def = PROPERTY_SYSTEM_FIELD_MAP[id];
  if (!def || def.locked) return false;
  return (
    systemStateOf(def, saved.systemFields[id]) !== systemStateOf(def, draft.systemFields[id]) ||
    !sameCondition(saved.systemFields[id]?.conditional, draft.systemFields[id]?.conditional)
  );
}

/** "Shown only when Laundry service enabled is Yes" from a stored condition. */
export function conditionSentence(condition: FieldCondition | undefined, labels: ReadonlyMap<string, string>): string | null {
  if (!condition) return null;
  const target = labels.get(condition.fieldId) ?? condition.fieldId;
  const value = condition.value === true ? "Yes" : condition.value === false ? "No" : condition.value === undefined ? "" : String(condition.value);
  switch (condition.operator) {
    case "answered":
      return `Shown only when ${target} is filled in`;
    case "notAnswered":
      return `Shown only when ${target} is blank`;
    case "notEquals":
      return `Shown only when ${target} is not ${value}`;
    case "gt":
      return `Shown only when ${target} is more than ${value}`;
    case "lt":
      return `Shown only when ${target} is less than ${value}`;
    case "oneOf":
      return `Shown only when ${target} is one of ${Array.isArray(condition.value) ? condition.value.join(", ") : value}`;
    default:
      return `Shown only when ${target} is ${value}`;
  }
}

export type PreviewField = { id: string; label: string; required: boolean; kind: "input" | "switch" | "select"; note: string | null; options?: string[]; placeholder?: string };
export type PreviewGroup = { id: string; label: string; fields: PreviewField[] };

/** The new property form as staff see it with the draft: hidden fields left out, "required" in words. */
export function previewGroups(config: PropertyFormConfig, labels: ReadonlyMap<string, string>): PreviewGroup[] {
  const groups: PreviewGroup[] = [];
  for (const groupId of ["details", "access", "quality", "notes"]) {
    const fields: PreviewField[] = [];
    for (const def of PROPERTY_SYSTEM_FIELDS.filter((field) => field.group === groupId)) {
      const override = config.systemFields[def.id];
      const state = def.locked ? "required" : systemStateOf(def, override);
      if (state === "hidden") continue;
      fields.push({
        id: def.id,
        label: def.label,
        required: state === "required" && def.supportsRequired !== false,
        kind: def.supportsRequired ? "input" : "switch",
        note: conditionSentence(override?.conditional, labels),
      });
    }
    if (fields.length > 0) groups.push({ id: groupId, label: GROUP_LABEL[groupId] ?? groupId, fields });
  }
  const custom: PreviewField[] = config.customFields.map((field: CustomFieldDef) => ({
    id: field.id,
    label: field.label || "Untitled field",
    required: field.required === true,
    kind: field.type === "select" ? "select" : field.type === "yesno" ? "switch" : "input",
    note: conditionSentence(field.conditional, labels),
    options: field.options,
    placeholder: field.placeholder ?? field.helpText,
  }));
  if (custom.length > 0) groups.push({ id: "custom", label: "Your fields", fields: custom });
  return groups;
}

export function newCustomFieldId(): string {
  return `cf_${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6)}`;
}
