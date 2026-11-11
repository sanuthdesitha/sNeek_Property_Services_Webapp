/**
 * Finding "the same question" across several form templates, for the library's
 * bulk "Edit a question in all selected forms".
 *
 * MATCHING RULE (documented in docs/SYSTEM.md, "Forms library"):
 *  - By field id: the field (or sub-field) whose id equals the given id.
 *  - By wording: section title + question label + question type, where titles
 *    and labels are compared after trimming, collapsing whitespace and ignoring
 *    letter case. The type must be identical.
 *  Exactly one match edits that question. No match, or more than one match in
 *  the same form, leaves that form unchanged and says why. Nothing is guessed.
 *
 * PURE: no database.
 */
import { isReadOnlyFieldType } from "./field-types";

export type SchemaNode = Record<string, unknown>;

export type QuestionLocation = {
  sectionId: string;
  sectionTitle: string;
  field: SchemaNode;
  isChild: boolean;
};

export type QuestionMatch =
  | { kind: "fieldId"; fieldId: string }
  | { kind: "wording"; section: string; label: string; type: string };

export type QuestionFindResult =
  | { ok: true; location: QuestionLocation }
  | { ok: false; reason: string };

export type QuestionIndexEntry = {
  /** Stable key for the picker; send `match` back to the server. */
  key: string;
  match: Extract<QuestionMatch, { kind: "wording" }>;
  /** Forms in the selection holding this question exactly once. */
  formCount: number;
  /** Forms in the selection holding it more than once (left unchanged). */
  repeatedIn: number;
};

export function isNode(value: unknown): value is SchemaNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWording(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

export function sectionTitleOf(section: SchemaNode): string {
  if (typeof section.title === "string" && section.title.trim()) return section.title.trim();
  if (typeof section.label === "string" && section.label.trim()) return section.label.trim();
  return "";
}

export function questionKey(section: string, label: string, type: string): string {
  return JSON.stringify([normalizeWording(section), normalizeWording(label), type]);
}

export function schemaSections(schema: unknown): SchemaNode[] {
  if (!isNode(schema) || !Array.isArray(schema.sections)) return [];
  return schema.sections.filter(isNode);
}

/** Every question and sub-question, in form order. */
export function listQuestions(schema: unknown): QuestionLocation[] {
  const out: QuestionLocation[] = [];
  for (const section of schemaSections(schema)) {
    const sectionId = typeof section.id === "string" ? section.id : "";
    const sectionTitle = sectionTitleOf(section);
    const fields = Array.isArray(section.fields) ? section.fields.filter(isNode) : [];
    for (const field of fields) {
      out.push({ sectionId, sectionTitle, field, isChild: false });
      const children = Array.isArray(field.children) ? field.children.filter(isNode) : [];
      for (const child of children) out.push({ sectionId, sectionTitle, field: child, isChild: true });
    }
  }
  return out;
}

function locationKey(location: QuestionLocation): string {
  return questionKey(location.sectionTitle, String(location.field.label ?? ""), String(location.field.type ?? ""));
}

export function findQuestion(schema: unknown, match: QuestionMatch): QuestionFindResult {
  const questions = listQuestions(schema);
  if (match.kind === "fieldId") {
    const found = questions.filter((q) => q.field.id === match.fieldId);
    if (found.length === 1) return { ok: true, location: found[0] };
    if (found.length === 0) return { ok: false, reason: `No question with id "${match.fieldId}" in this form.` };
    return { ok: false, reason: `The id "${match.fieldId}" is used ${found.length} times in this form; fix it in the builder.` };
  }
  const key = questionKey(match.section, match.label, match.type);
  const found = questions.filter((q) => locationKey(q) === key);
  if (found.length === 1) return { ok: true, location: found[0] };
  if (found.length === 0) {
    return { ok: false, reason: `"${match.section ? `${match.section}: ` : ""}${match.label}" (${match.type}) is not in this form.` };
  }
  return {
    ok: false,
    reason: `"${match.label}" appears ${found.length} times in "${match.section}"; edit this form in the builder.`,
  };
}

/** The questions present in the selected forms, for the bulk picker. */
export function buildQuestionIndex(schemas: unknown[]): QuestionIndexEntry[] {
  const entries = new Map<string, QuestionIndexEntry>();
  for (const schema of schemas) {
    const perForm = new Map<string, { count: number; location: QuestionLocation }>();
    for (const location of listQuestions(schema)) {
      const key = locationKey(location);
      const seen = perForm.get(key);
      perForm.set(key, { count: (seen?.count ?? 0) + 1, location: seen?.location ?? location });
    }
    for (const [key, { count, location }] of Array.from(perForm.entries())) {
      const entry =
        entries.get(key) ??
        {
          key,
          match: {
            kind: "wording" as const,
            section: location.sectionTitle,
            label: String(location.field.label ?? ""),
            type: String(location.field.type ?? ""),
          },
          formCount: 0,
          repeatedIn: 0,
        };
      if (count === 1) entry.formCount += 1;
      else entry.repeatedIn += 1;
      entries.set(key, entry);
    }
  }
  return Array.from(entries.values()).sort(
    (a, b) =>
      b.formCount - a.formCount ||
      a.match.section.localeCompare(b.match.section) ||
      a.match.label.localeCompare(b.match.label),
  );
}

/** Lower-case text a search box matches: section titles and question labels. */
export function searchableQuestionText(schema: unknown): string {
  const parts: string[] = [];
  for (const section of schemaSections(schema)) parts.push(sectionTitleOf(section));
  for (const question of listQuestions(schema)) {
    if (typeof question.field.label === "string") parts.push(question.field.label);
  }
  return normalizeWording(parts.join(" \n "));
}

/** Questions a cleaner answers: every field and sub-field except read-only blocks. */
export function countQuestions(schema: unknown): number {
  return listQuestions(schema).filter((q) => !isReadOnlyFieldType(typeof q.field.type === "string" ? q.field.type : null)).length;
}
