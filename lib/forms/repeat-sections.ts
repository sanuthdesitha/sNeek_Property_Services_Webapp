/**
 * Per-room repeat of a form section at read time.
 *
 * A section with `repeatBy: "bedrooms" | "bathrooms"` is shown once per room
 * of the job's property, with the SAME id scheme lib/checklists/compose.ts
 * uses for the property checklist's repeated modules:
 *   section id  `${id}-${n}`, title `${title} — Bedroom ${n}`,
 *   question id `${questionId}__bed${n}` / `__bath${n}` (sub-questions too).
 * A rule that watches a question in the same section is re-pointed at that
 * room's copy. With one room (or a missing count, treated as one room, as
 * compose does) the section is kept as it is, ids unchanged.
 *
 * Idempotent: the expanded sections carry no `repeatBy`, so running it twice
 * changes nothing. Schemas without `repeatBy` are returned unchanged
 * (same reference), so every existing form resolves exactly as before.
 *
 * PURE.
 */

type Node = Record<string, unknown>;

export type RoomCounts = { bedrooms?: unknown; bathrooms?: unknown };

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function schemaHasRepeatedSections(schema: unknown): boolean {
  return isNode(schema) && Array.isArray(schema.sections) && schema.sections.some((section) => isNode(section) && section.repeatBy !== undefined);
}

function roomCount(repeatBy: unknown, counts: RoomCounts): number {
  const raw = repeatBy === "bathrooms" ? counts.bathrooms : counts.bedrooms;
  return Math.max(1, Math.floor(Number(raw ?? 1)) || 1);
}

function suffixedField(field: Node, suffix: string, sectionIds: ReadonlySet<string>): Node {
  const copy: Node = { ...field, id: `${String(field.id)}${suffix}` };
  const rule = field.conditional;
  if (isNode(rule) && typeof rule.fieldId === "string" && sectionIds.has(rule.fieldId)) {
    copy.conditional = { ...rule, fieldId: `${rule.fieldId}${suffix}` };
  }
  if (Array.isArray(field.children)) {
    copy.children = field.children.filter(isNode).map((child) => suffixedField(child, suffix, sectionIds));
  }
  return copy;
}

function idsInSection(section: Node): Set<string> {
  const ids = new Set<string>();
  for (const field of Array.isArray(section.fields) ? section.fields.filter(isNode) : []) {
    if (typeof field.id === "string") ids.add(field.id);
    for (const child of Array.isArray(field.children) ? field.children.filter(isNode) : []) {
      if (typeof child.id === "string") ids.add(child.id);
    }
  }
  return ids;
}

export function expandRepeatedSections<T>(schema: T, counts: RoomCounts): T {
  if (!schemaHasRepeatedSections(schema)) return schema;
  const root = schema as unknown as Node;
  const sections = (root.sections as unknown[]).flatMap((section) => {
    if (!isNode(section) || section.repeatBy === undefined) return [section];
    const { repeatBy, ...rest } = section;
    const total = roomCount(repeatBy, counts);
    if (total <= 1) return [rest];
    const unit = repeatBy === "bathrooms" ? "Bathroom" : "Bedroom";
    const short = repeatBy === "bathrooms" ? "bath" : "bed";
    const local = idsInSection(section);
    const fields = Array.isArray(section.fields) ? section.fields.filter(isNode) : [];
    return Array.from({ length: total }, (_, index) => {
      const n = index + 1;
      return {
        ...rest,
        id: `${String(section.id)}-${n}`,
        title: `${String(section.title ?? section.label ?? unit)} — ${unit} ${n}`,
        fields: fields.map((field) => suffixedField(field, `__${short}${n}`, local)),
      };
    });
  });
  return { ...root, sections } as unknown as T;
}
