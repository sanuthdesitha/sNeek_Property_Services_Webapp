/**
 * QA template editor helpers (board "QA templates", 2026-11-17): loose
 * section and criterion shapes (real schemas mix the simple rating shape with
 * form-builder fields, so every unknown property is kept), plain type words,
 * and the raw JSON error that names its line. PURE (plain module).
 */
export type LooseField = Record<string, unknown> & {
  id?: string;
  label?: string;
  type?: string;
  weight?: number;
  max?: number;
  required?: boolean;
  options?: unknown;
  scoring?: { max?: number; weight?: number } & Record<string, unknown>;
};

export type LooseSection = Record<string, unknown> & { id?: string; label?: string; title?: string; fields?: LooseField[] };

export type EditableSchema = { sections: LooseSection[] } & Record<string, unknown>;

export const CRITERION_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "rating", label: "Rating" },
  { value: "yesno", label: "Yes / No" },
  { value: "radio", label: "Choice" },
  { value: "select", label: "Choice list" },
  { value: "checkbox", label: "Tick" },
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "photo", label: "Photo" },
  { value: "upload", label: "Upload" },
];

export function typeWord(type: string): string {
  return CRITERION_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

export function isEditableSchema(schema: unknown): schema is EditableSchema {
  return Boolean(schema) && typeof schema === "object" && Array.isArray((schema as { sections?: unknown }).sections);
}

export function sectionTitle(section: LooseSection, index: number): string {
  const value = section.label ?? section.title;
  return typeof value === "string" && value.trim() ? value : `Section ${index + 1}`;
}

export function fieldWeight(field: LooseField): number | null {
  const value = field.scoring && typeof field.scoring.weight === "number" ? field.scoring.weight : field.weight;
  return typeof value === "number" ? value : null;
}

export function fieldMax(field: LooseField): number | null {
  const value = field.scoring && typeof field.scoring.max === "number" ? field.scoring.max : field.max;
  return typeof value === "number" ? value : null;
}

/** Scored criteria carry a weight and a maximum. */
export function isScorable(field: LooseField): boolean {
  return String(field.type ?? "rating") === "rating" || Boolean(field.scoring && typeof field.scoring === "object");
}

export function hasOptions(field: LooseField): boolean {
  return Array.isArray(field.options) || ["radio", "select"].includes(String(field.type ?? ""));
}

export function optionWords(field: LooseField): string[] {
  if (!Array.isArray(field.options)) return [];
  return field.options.map((option) =>
    typeof option === "object" && option !== null
      ? String((option as { label?: unknown; value?: unknown }).label ?? (option as { value?: unknown }).value ?? "")
      : String(option),
  );
}

/** "Fridge condition: Clean · Marks · Dirty" style description of a criterion, for the preview. */
export function criterionNote(field: LooseField): string | null {
  const notes: string[] = [];
  if (field.required === true) notes.push("required");
  const weight = fieldWeight(field);
  if (weight !== null && weight > 1) notes.push(weight === 2 ? "counts double" : `counts ×${weight}`);
  return notes.length > 0 ? notes.join(" · ") : null;
}

/** Parses raw JSON; a failure names the line, so "Invalid JSON is not saved and the error names the line". */
export function parseRawSchema(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Invalid JSON";
    const position = /position (\d+)/i.exec(message)?.[1];
    const lineMatch = /line (\d+)/i.exec(message)?.[1];
    const line = lineMatch ? Number(lineMatch) : position ? text.slice(0, Number(position)).split("\n").length : null;
    return { ok: false, error: line ? `The JSON is not valid on line ${line}. It was not saved.` : "The JSON is not valid. It was not saved." };
  }
}

export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items.slice();
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}
