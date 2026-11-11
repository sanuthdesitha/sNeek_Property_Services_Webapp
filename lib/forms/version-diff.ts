/**
 * Summary of what changed between two versions of a form: questions added,
 * removed and changed (label, type, required, options, rules, cadence …), and
 * sections added or removed. Questions are matched by id, which the builder
 * keeps stable across edits (submissions are keyed by it).
 *
 * PURE: tolerant of any stored schema shape.
 */

type Node = Record<string, unknown>;

export type DiffQuestion = { id: string; label: string; section: string };
export type ChangedQuestion = DiffQuestion & { changes: string[] };

export type VersionDiff = {
  added: DiffQuestion[];
  removed: DiffQuestion[];
  changed: ChangedQuestion[];
  sectionsAdded: string[];
  sectionsRemoved: string[];
  /** True when nothing a cleaner sees differs. */
  identical: boolean;
};

const COMPARED: Array<{ key: string; label: string }> = [
  { key: "label", label: "wording" },
  { key: "type", label: "type" },
  { key: "required", label: "required" },
  { key: "options", label: "options" },
  { key: "allowOther", label: "\"Other\" answer" },
  { key: "helpText", label: "help text" },
  { key: "instructions", label: "instructions" },
  { key: "conditional", label: "show/hide rule" },
  { key: "frequency", label: "how often" },
  { key: "rotationEveryNCleans", label: "how often" },
  { key: "minPhotos", label: "minimum photos" },
  { key: "maxFiles", label: "maximum files" },
  { key: "min", label: "range" },
  { key: "max", label: "range" },
  { key: "detailsWhenNo", label: "details when No" },
  { key: "includeNa", label: "N/A option" },
  { key: "references", label: "example media" },
  { key: "scoring", label: "QA scoring" },
  { key: "children", label: "sub-questions" },
];

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sectionsOf(schema: unknown): Node[] {
  return isNode(schema) && Array.isArray(schema.sections) ? schema.sections.filter(isNode) : [];
}

function titleOf(section: Node): string {
  return String(section.title ?? section.label ?? section.id ?? "Section");
}

function questionsOf(schema: unknown): Map<string, { field: Node; section: string }> {
  const map = new Map<string, { field: Node; section: string }>();
  for (const section of sectionsOf(schema)) {
    const fields = Array.isArray(section.fields) ? section.fields.filter(isNode) : [];
    for (const field of fields) {
      if (typeof field.id === "string") map.set(field.id, { field, section: titleOf(section) });
    }
  }
  return map;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function diffFormVersions(base: unknown, next: unknown): VersionDiff {
  const before = questionsOf(base);
  const after = questionsOf(next);
  const label = (field: Node, id: string) => (typeof field.label === "string" && field.label.trim() ? field.label : id);

  const added: DiffQuestion[] = [];
  const changed: ChangedQuestion[] = [];
  after.forEach((entry, id) => {
    const previous = before.get(id);
    if (!previous) {
      added.push({ id, label: label(entry.field, id), section: entry.section });
      return;
    }
    const changes = new Set<string>();
    for (const { key, label: name } of COMPARED) {
      if (!same(previous.field[key], entry.field[key])) changes.add(name);
    }
    if (previous.section !== entry.section) changes.add(`moved from ${previous.section}`);
    if (changes.size > 0) changed.push({ id, label: label(entry.field, id), section: entry.section, changes: Array.from(changes) });
  });
  const removed: DiffQuestion[] = [];
  before.forEach((entry, id) => {
    if (!after.has(id)) removed.push({ id, label: label(entry.field, id), section: entry.section });
  });

  const beforeSections = new Set(sectionsOf(base).map((section) => String(section.id)));
  const afterSections = new Set(sectionsOf(next).map((section) => String(section.id)));
  const sectionsAdded = sectionsOf(next).filter((section) => !beforeSections.has(String(section.id))).map(titleOf);
  const sectionsRemoved = sectionsOf(base).filter((section) => !afterSections.has(String(section.id))).map(titleOf);

  return {
    added,
    removed,
    changed,
    sectionsAdded,
    sectionsRemoved,
    identical: added.length + removed.length + changed.length + sectionsAdded.length + sectionsRemoved.length === 0,
  };
}
