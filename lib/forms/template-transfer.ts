/**
 * Export and import of job forms as a JSON file.
 *
 * FILE (format "sneek.form-templates", formatVersion 1):
 *   { format, formatVersion, exportedAt, forms: [{ name, serviceType, tags,
 *     source, sourceVersion, schema }] }
 * No template, group or user ids (the importing side makes new rows) and no
 * secrets: presigned media URLs (logo, reference images) are dropped, only the
 * storage key is kept, which resolves to a fresh link when shown.
 *
 * IMPORT is validated strictly before anything is created:
 *  - size and count caps (IMPORT_MAX_BYTES, IMPORT_MAX_FORMS,
 *    IMPORT_MAX_QUESTIONS);
 *  - the format and version must match; name, service type and tags checked;
 *  - each schema goes through the builder's strict save check
 *    (validateFormSchemaForSave), so an unknown question type is refused with
 *    the reason, per form;
 *  - question / section ids are kept, and regenerated only when they collide
 *    inside one form; conditions keep pointing at the question that kept the id.
 * Creating the drafts is template-import.ts (server); this file is PURE.
 */
import { checkTemplateSchema } from "./template-checks";
import { validateFormSchemaForSave } from "./template-schema";
import { countQuestions, isNode, type SchemaNode } from "./template-questions";

export const TRANSFER_FORMAT = "sneek.form-templates";
export const TRANSFER_FORMAT_VERSION = 1;
export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_FORMS = 20;
export const IMPORT_MAX_QUESTIONS = 500;
export const EXPORT_MAX_FORMS = 50;

export type ExportedForm = {
  name: string;
  serviceType: string;
  tags: string[];
  source: "draft" | "live";
  sourceVersion: number;
  schema: unknown;
};

export type FormExportFile = {
  format: typeof TRANSFER_FORMAT;
  formatVersion: typeof TRANSFER_FORMAT_VERSION;
  exportedAt: string;
  forms: ExportedForm[];
};

export type ImportPreviewForm = {
  index: number;
  name: string;
  serviceType: string;
  tags: string[];
  sections: number;
  questions: number;
  checks: { errors: number; warnings: number; messages: string[] };
  /** Ids regenerated because they collided inside this form. */
  renamedIds: number;
  /** Why this form will not be imported; null = it will be created as a draft. */
  refused: string | null;
  /** The schema that would be stored (ids fixed). */
  schema: unknown;
};

export type ImportOutcome = {
  dryRun: boolean;
  forms: Array<ImportPreviewForm & { createdId?: string; createdName?: string }>;
  created: number;
  refused: number;
};

export type ImportParseResult = { ok: true; forms: ImportPreviewForm[] } | { ok: false; error: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Drop presigned links (they carry signatures); keep storage keys and plain external links. */
export function sanitizeSchemaForExport(schema: unknown): unknown {
  if (!isNode(schema)) return schema;
  const copy = clone(schema) as SchemaNode;
  if (isNode(copy.theme) && typeof copy.theme.logoKey === "string") delete copy.theme.logoUrl;
  const cleanField = (field: SchemaNode) => {
    if (Array.isArray(field.references)) {
      field.references = field.references.filter(isNode).map((reference) => {
        const next = { ...reference };
        if (typeof next.storageKey === "string" && next.storageKey) delete next.url;
        return next;
      });
    }
    if (Array.isArray(field.children)) field.children.filter(isNode).forEach(cleanField);
  };
  for (const section of Array.isArray(copy.sections) ? copy.sections.filter(isNode) : []) {
    for (const field of Array.isArray(section.fields) ? section.fields.filter(isNode) : []) cleanField(field);
  }
  return copy;
}

export function buildExportFile(forms: ExportedForm[], now: Date): FormExportFile {
  return {
    format: TRANSFER_FORMAT,
    formatVersion: TRANSFER_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    forms: forms.map((form) => ({ ...form, schema: sanitizeSchemaForExport(form.schema) })),
  };
}

/** Make section and question ids unique inside one schema; returns how many changed. */
export function fixCollidingIds(schema: unknown): { schema: unknown; renamed: number } {
  if (!isNode(schema) || !Array.isArray(schema.sections)) return { schema, renamed: 0 };
  const copy = clone(schema) as SchemaNode;
  const used = new Set<string>();
  let renamed = 0;
  const unique = (id: unknown, fallback: string): string => {
    const base = typeof id === "string" && id.trim() ? id : fallback;
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let n = 2;
    while (used.has(`${base}_${n}`)) n += 1;
    renamed += 1;
    used.add(`${base}_${n}`);
    return `${base}_${n}`;
  };
  (copy.sections as unknown[]).filter(isNode).forEach((section, sIdx) => {
    section.id = unique(section.id, `section_${sIdx + 1}`);
    (Array.isArray(section.fields) ? section.fields : []).filter(isNode).forEach((field, fIdx) => {
      field.id = unique(field.id, `${String(section.id)}_q${fIdx + 1}`);
      (Array.isArray(field.children) ? field.children : []).filter(isNode).forEach((child, cIdx) => {
        child.id = unique(child.id, `${String(field.id)}_sub${cIdx + 1}`);
      });
    });
  });
  return { schema: copy, renamed };
}

function readTags(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const tags = value.map((tag) => (typeof tag === "string" ? tag.trim() : ""));
  return tags.every((tag) => tag.length >= 1 && tag.length <= 30) ? Array.from(new Set(tags)) : null;
}

function previewForm(raw: unknown, index: number, serviceTypes: ReadonlySet<string>): ImportPreviewForm {
  const node = isNode(raw) ? raw : {};
  const name = typeof node.name === "string" ? node.name.trim() : "";
  const serviceType = typeof node.serviceType === "string" ? node.serviceType : "";
  const tags = readTags(node.tags);
  const base: ImportPreviewForm = {
    index,
    name: name || `Form ${index + 1}`,
    serviceType,
    tags: tags ?? [],
    sections: 0,
    questions: 0,
    checks: { errors: 0, warnings: 0, messages: [] },
    renamedIds: 0,
    refused: null,
    schema: null,
  };
  if (!isNode(raw)) return { ...base, refused: "This entry is not a form." };
  if (!name || name.length > 100) return { ...base, refused: "A form needs a name of 1–100 characters." };
  if (!serviceTypes.has(serviceType)) return { ...base, refused: `Unknown service type (${serviceType || "none"}).` };
  if (tags === null) return { ...base, refused: "Tags must be up to 20 words of 1–30 characters." };
  const fixed = fixCollidingIds(node.schema);
  const schema = fixed.schema;
  const sections = isNode(schema) && Array.isArray(schema.sections) ? schema.sections.length : 0;
  const questions = countQuestions(schema);
  const counted = { ...base, sections, questions, renamedIds: fixed.renamed, schema };
  if (questions > IMPORT_MAX_QUESTIONS) return { ...counted, refused: `More than ${IMPORT_MAX_QUESTIONS} questions.` };
  const strict = validateFormSchemaForSave(schema);
  if (!strict.ok) {
    return { ...counted, refused: strict.issues.slice(0, 3).map((issue) => issue.message).join(" ") };
  }
  const checks = checkTemplateSchema(schema);
  return {
    ...counted,
    checks: { errors: checks.errors, warnings: checks.warnings, messages: checks.issues.slice(0, 5).map((issue) => issue.message) },
  };
}

/** Validate an uploaded file's text. `serviceTypes` = the JobType values. */
export function parseImportFile(text: string, serviceTypes: readonly string[]): ImportParseResult {
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) {
    return { ok: false, error: `The file is larger than ${Math.round(IMPORT_MAX_BYTES / 1000)} KB.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  if (!isNode(parsed) || parsed.format !== TRANSFER_FORMAT) return { ok: false, error: "This is not a form export from this app." };
  if (parsed.formatVersion !== TRANSFER_FORMAT_VERSION) {
    return { ok: false, error: `This export uses format version ${String(parsed.formatVersion)}; only version ${TRANSFER_FORMAT_VERSION} can be imported.` };
  }
  if (!Array.isArray(parsed.forms) || parsed.forms.length === 0) return { ok: false, error: "The file holds no forms." };
  if (parsed.forms.length > IMPORT_MAX_FORMS) return { ok: false, error: `The file holds ${parsed.forms.length} forms; import at most ${IMPORT_MAX_FORMS} at a time.` };
  const types = new Set(serviceTypes);
  return { ok: true, forms: parsed.forms.map((form, index) => previewForm(form, index, types)) };
}

/** "Name (imported)", "Name (imported 2)" … when the name is already used. */
export function importedName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((value) => value.trim().toLowerCase()));
  if (!taken.has(name.trim().toLowerCase())) return name;
  const first = `${name} (imported)`.slice(0, 100);
  if (!taken.has(first.toLowerCase())) return first;
  let n = 2;
  while (taken.has(`${name} (imported ${n})`.toLowerCase())) n += 1;
  return `${name} (imported ${n})`.slice(0, 100);
}
