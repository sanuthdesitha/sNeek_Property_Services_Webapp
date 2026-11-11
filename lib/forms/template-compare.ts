/**
 * The library's Compare view: 2–4 forms side by side, by section and
 * question.
 *
 * Questions are matched with the library's existing rule
 * (template-questions.ts): section title + question label + question type,
 * compared after trimming, collapsing spaces and ignoring case. A question
 * that appears more than once in one form is "repeated" there and is not
 * compared (nothing is guessed).
 *
 * Every difference is relative to the FIRST form (the reference) and carries
 * a text marker, never colour alone:
 *   added    in this form, not in the reference
 *   missing  in the reference (or another form), not in this one
 *   changed  in both, with the names of the settings that differ
 *   same     in both, every compared setting equal
 *
 * PURE: no database. The route reads the schemas (draft if there is one).
 */
import { getFieldTypeDef } from "./field-types";
import { effectBadgeLabel, fieldEffects } from "./form-effects";
import { describeAnswerRule, ordinal } from "./question-badges";
import { listQuestions, normalizeWording, questionKey, type SchemaNode } from "./template-questions";
import { readTableConfig } from "./structured-answers";
import type { FieldCondition, FormField } from "./types";

export const COMPARE_MIN_FORMS = 2;
export const COMPARE_MAX_FORMS = 4;

export type CompareFormInput = { id: string; name: string; version: number; source: "draft" | "live"; schema: unknown };

/** Settings the bulk "edit a question" service can copy between forms. */
export const COPYABLE_PROPERTIES = ["required", "helpText", "minPhotos", "maxFiles", "severity", "detailsWhenNo"] as const;
export type CopyableProperty = (typeof COPYABLE_PROPERTIES)[number];

type PropertyDef = { key: string; label: string; read: (field: SchemaNode, labels: ReadonlyMap<string, string>) => string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const PROPERTIES: PropertyDef[] = [
  { key: "required", label: "Required", read: (f) => (f.required === true ? "Yes" : "No") },
  { key: "helpText", label: "Help text", read: (f) => text(f.helpText) || "–" },
  { key: "options", label: "Choices", read: (f) => (Array.isArray(f.options) && f.options.length ? f.options.map(String).join(", ") : "–") },
  { key: "minPhotos", label: "Minimum photos", read: (f) => (typeof f.minPhotos === "number" ? String(f.minPhotos) : "–") },
  { key: "maxFiles", label: "Maximum files", read: (f) => (typeof f.maxFiles === "number" ? String(f.maxFiles) : "–") },
  { key: "range", label: "Range", read: (f) => (f.min === undefined && f.max === undefined ? "–" : `${f.min ?? "…"}–${f.max ?? "…"}${text(f.unit) ? ` ${text(f.unit)}` : ""}`) },
  { key: "severity", label: "Priority", read: (f) => text(f.severity) || "–" },
  { key: "detailsWhenNo", label: "Details when No", read: (f) => (f.detailsWhenNo === true ? "Yes" : "No") },
  {
    key: "frequency",
    label: "How often",
    read: (f) => (f.frequency === "ROTATIONAL" ? `Every ${ordinal(Number(f.rotationEveryNCleans ?? 4))} clean` : f.frequency === "MONTHLY" ? "Monthly" : f.frequency === "CONDITIONAL" ? "When an exception is reported" : "Every clean"),
  },
  {
    key: "conditional",
    label: "Show only if",
    read: (f, labels) => {
      const rule = f.conditional as Record<string, unknown> | undefined;
      if (!rule || typeof rule !== "object") return "Always";
      if (typeof rule.propertyField === "string") return `Property ${rule.propertyField} is ${String(rule.value ?? rule.equals ?? "")}`;
      return typeof rule.fieldId === "string" ? describeAnswerRule(rule as unknown as FieldCondition, labels).replace(/^Shown if /, "") : "Always";
    },
  },
  { key: "locationTag", label: "Report area", read: (f) => text(f.locationTag) || "–" },
  { key: "scoring", label: "QA score", read: (f) => (f.scoring && typeof f.scoring === "object" ? "Counts" : "No") },
  { key: "subQuestions", label: "Sub-questions", read: (f) => (Array.isArray(f.children) ? String(f.children.length) : "0") },
  {
    key: "table",
    label: "Table",
    read: (f) => {
      if (f.type !== "table") return "–";
      const table = readTableConfig(f.table);
      return `${table.columns.map((c) => `${c.label} (${c.cellType})`).join(", ")}; ${table.rowMode === "fixed" ? `rows: ${(table.rowLabels ?? []).join(", ")}` : `cleaner adds ${table.minRows ?? 0}–${table.maxRows ?? "…"} rows`}`;
    },
  },
  { key: "stockItem", label: "Item counted", read: (f) => (f.type === "stock_count" ? text(f.stockItemName) || text(f.stockItemId) || "None" : "–") },
  { key: "effects", label: "When submitted", read: (f) => fieldEffects(f).map(effectBadgeLabel).join("; ") || "–" },
];

export type CompareCellState = "reference" | "same" | "changed" | "added" | "missing" | "repeated";

export type CompareCell = {
  formId: string;
  state: CompareCellState;
  /** The settings that differ from the reference (state "changed"). */
  changed: Array<{ key: string; label: string }>;
  /** Display value per compared setting (present cells only). */
  values: Record<string, string>;
  /** The question as stored (present cells), for "copy this question". */
  field?: SchemaNode;
};

export type CompareRow = {
  key: string;
  section: string;
  label: string;
  type: string;
  typeLabel: string;
  differs: boolean;
  cells: CompareCell[];
};

export type CompareSection = { title: string; rows: CompareRow[] };

export type TemplateComparison = {
  forms: Array<Omit<CompareFormInput, "schema">>;
  properties: Array<{ key: string; label: string; copyable: boolean }>;
  sections: CompareSection[];
  summary: { questions: number; differing: number };
};

type Holding = { count: number; field: SchemaNode; section: string; label: string; type: string };

function labelsOf(schema: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  for (const question of listQuestions(schema)) {
    if (typeof question.field.id === "string") labels.set(question.field.id, text(question.field.label));
  }
  return labels;
}

function valuesOf(field: SchemaNode, labels: ReadonlyMap<string, string>): Record<string, string> {
  return Object.fromEntries(PROPERTIES.map((property) => [property.key, property.read(field, labels)]));
}

export function compareTemplates(forms: CompareFormInput[]): TemplateComparison {
  if (forms.length < COMPARE_MIN_FORMS || forms.length > COMPARE_MAX_FORMS) {
    throw new Error(`Compare takes ${COMPARE_MIN_FORMS} to ${COMPARE_MAX_FORMS} forms.`);
  }
  const order: string[] = [];
  const perForm = forms.map((form) => {
    const held = new Map<string, Holding>();
    for (const question of listQuestions(form.schema)) {
      const label = text(question.field.label);
      const type = typeof question.field.type === "string" ? question.field.type : "";
      const key = questionKey(question.sectionTitle, label, type);
      const seen = held.get(key);
      if (seen) seen.count += 1;
      else held.set(key, { count: 1, field: question.field, section: question.sectionTitle, label, type });
      if (!order.includes(key)) order.push(key);
    }
    return { held, labels: labelsOf(form.schema) };
  });

  const sections = new Map<string, CompareSection>();
  let differing = 0;
  for (const key of order) {
    const sample = perForm.map((entry) => entry.held.get(key)).find(Boolean)!;
    const reference = perForm[0].held.get(key);
    const referenceValues = reference && reference.count === 1 ? valuesOf(reference.field, perForm[0].labels) : null;
    const cells = forms.map<CompareCell>((form, index) => {
      const holding = perForm[index].held.get(key);
      if (!holding) return { formId: form.id, state: "missing", changed: [], values: {} };
      if (holding.count > 1) return { formId: form.id, state: "repeated", changed: [], values: {} };
      const values = valuesOf(holding.field, perForm[index].labels);
      if (index === 0) return { formId: form.id, state: "reference", changed: [], values, field: holding.field };
      if (reference && !referenceValues) {
        return { formId: form.id, state: "changed", changed: [{ key: "reference", label: "The first form holds this question more than once" }], values, field: holding.field };
      }
      if (!referenceValues) return { formId: form.id, state: "added", changed: [], values, field: holding.field };
      const changed = PROPERTIES.filter((property) => values[property.key] !== referenceValues[property.key]).map((property) => ({ key: property.key, label: property.label }));
      return { formId: form.id, state: changed.length ? "changed" : "same", changed, values, field: holding.field };
    });
    const differs = cells.some((cell) => cell.state !== "reference" && cell.state !== "same");
    if (differs) differing += 1;
    const sectionKey = normalizeWording(sample.section);
    const section = sections.get(sectionKey) ?? { title: sample.section || "Untitled section", rows: [] };
    section.rows.push({
      key,
      section: sample.section,
      label: sample.label,
      type: sample.type,
      typeLabel: getFieldTypeDef(sample.type)?.label ?? sample.type,
      differs,
      cells,
    });
    sections.set(sectionKey, section);
  }
  return {
    forms: forms.map(({ schema: _schema, ...form }) => form),
    properties: PROPERTIES.map((property) => ({ key: property.key, label: property.label, copyable: (COPYABLE_PROPERTIES as readonly string[]).includes(property.key) })),
    sections: Array.from(sections.values()),
    summary: { questions: order.length, differing },
  };
}

/** The bulk edit value for copying one setting from a source question (null = not copyable). */
export function copyableEdit(property: string, field: SchemaNode): { property: CopyableProperty; value: unknown } | null {
  const f = field as Partial<FormField>;
  switch (property) {
    case "required":
      return { property, value: f.required === true };
    case "helpText":
      return { property, value: typeof f.helpText === "string" ? f.helpText.slice(0, 500) : "" };
    case "minPhotos":
      return typeof f.minPhotos === "number" ? { property, value: f.minPhotos } : null;
    case "maxFiles":
      return typeof f.maxFiles === "number" ? { property, value: f.maxFiles } : null;
    case "severity":
      return { property, value: f.severity ?? null };
    case "detailsWhenNo":
      return { property, value: f.detailsWhenNo === true };
    default:
      return null;
  }
}
