// Single source of truth for turning ANY stored/generated form-template schema
// (legacy or new) into one canonical shape, then guaranteeing the standard
// sections. This MUST be applied identically wherever a job form is read (the
// cleaner UI) and validated (the submit route) — otherwise the cleaner fills one
// shape while the server enforces another, which surfaces as "can't advance to
// uploads / error on Next" (the required-field set differs between the two).
//
// Canonicalisations (make old templates behave like new ones):
//  - section heading: legacy `label` → `title`
//  - conditional: legacy `{ fieldId, equals }` → `{ fieldId, operator:"equals", value }`
//  - field type aliases: `upload` → `photo`, `textarea` → `longtext`
//  - backfill a stable `id` on any section/field missing one (deterministic, so
//    read and submit derive the same id from the same raw schema)
//  - keep one-level `children`
// Then apply `withStandardSections` (arrival evidence + exception report +
// sign-off) IDEMPOTENTLY so double application can never duplicate them.

import { withStandardSections } from "@/lib/checklists/compose";

type AnyRec = Record<string, any>;

function slug(input: unknown, fallback: string): string {
  const s = String(input ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

function normalizeConditional(cond: unknown): AnyRec | undefined {
  if (!cond || typeof cond !== "object") return undefined;
  const raw = cond as AnyRec;
  // Property-field conditions pass through untouched.
  if ("propertyField" in raw) return raw;
  if (!("fieldId" in raw)) return raw;
  const operator = typeof raw.operator === "string" ? raw.operator : "equals";
  const out: AnyRec = { fieldId: raw.fieldId, operator };
  if ("value" in raw) out.value = raw.value;
  else if ("equals" in raw) out.value = raw.equals; // legacy shape
  return out;
}

function aliasType(type: unknown): unknown {
  if (type === "upload") return "photo"; // legacy media alias (validation already treats it as upload)
  if (type === "textarea") return "longtext"; // legacy long-text alias
  return type;
}

function normalizeField(field: unknown, sectionId: string, index: number, depth: number): AnyRec | null {
  if (!field || typeof field !== "object") return null;
  const raw = field as AnyRec;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : `${sectionId}.field-${index}`;
  const out: AnyRec = { ...raw, id, type: aliasType(raw.type) };
  const cond = normalizeConditional(raw.conditional);
  if (cond) out.conditional = cond;
  else delete out.conditional;
  if (depth === 0 && Array.isArray(raw.children)) {
    out.children = raw.children
      .map((child: unknown, i: number) => normalizeField(child, id, i, depth + 1))
      .filter(Boolean);
  }
  return out;
}

function normalizeSection(section: unknown, index: number): AnyRec | null {
  if (!section || typeof section !== "object") return null;
  const raw = section as AnyRec;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title : raw.label;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : slug(title, `section-${index}`);
  const out: AnyRec = { ...raw, id, title };
  const cond = normalizeConditional(raw.conditional);
  if (cond) out.conditional = cond;
  else delete out.conditional;
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  out.fields = fields.map((f: unknown, i: number) => normalizeField(f, id, i, 0)).filter(Boolean);
  return out;
}

/**
 * Canonicalise a schema and guarantee the standard sections. Idempotent:
 * `normalizeFormSchema(normalizeFormSchema(x))` equals `normalizeFormSchema(x)`.
 */
export function normalizeFormSchema(schema: unknown): { sections: any[]; theme?: any } {
  const raw = (schema && typeof schema === "object" ? schema : {}) as AnyRec;
  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const canonical = rawSections.map((s: unknown, i: number) => normalizeSection(s, i)).filter(Boolean) as AnyRec[];
  const withStandard = withStandardSections(canonical) as any[];
  const out: { sections: any[]; theme?: any } = { sections: withStandard };
  if (raw.theme && typeof raw.theme === "object") out.theme = raw.theme;
  return out;
}
