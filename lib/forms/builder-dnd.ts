/**
 * Drag-and-drop targets of the builder as pure functions, so pointer drags,
 * keyboard drags (dnd-kit's keyboard sensor) and the row menu's "Move up /
 * down / to section" all end in the same schema operation.
 *
 * Draggable ids are prefixed: `section:<id>` (outline rows) and
 * `field:<id>` (question rows).
 */
import { moveFieldsToSection, reorderField, reorderSection } from "./builder-ops";
import type { FormSchema } from "./types";

export const sectionDragId = (id: string) => `section:${id}`;
export const fieldDragId = (id: string) => `field:${id}`;

export function parseDragId(raw: string | number | null | undefined): { kind: "section" | "field"; id: string } | null {
  const value = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
  if (value.startsWith("section:")) return { kind: "section", id: value.slice("section:".length) };
  if (value.startsWith("field:")) return { kind: "field", id: value.slice("field:".length) };
  return null;
}

/**
 * Apply a finished drag. Dragging a SELECTED question moves the whole
 * selection; dropping a question on an outline section moves it (or them) to
 * the end of that section.
 */
export function applyDrop(
  schema: FormSchema,
  activeRaw: string | number,
  overRaw: string | number | null | undefined,
  selectedIds: readonly string[] = [],
): FormSchema {
  const active = parseDragId(activeRaw);
  const over = parseDragId(overRaw);
  if (!active || !over) return schema;
  if (active.kind === "section") {
    return over.kind === "section" ? reorderSection(schema, active.id, over.id) : schema;
  }
  const moving = selectedIds.includes(active.id) && selectedIds.length > 1 ? selectedIds : [active.id];
  if (over.kind === "section") return moveFieldsToSection(schema, moving, over.id);
  if (moving.length > 1) {
    const target = schema.sections.find((section) => section.fields.some((field) => field.id === over.id));
    if (!target || moving.includes(over.id)) return schema;
    const index = target.fields.filter((field) => !moving.includes(field.id)).findIndex((field) => field.id === over.id);
    return moveFieldsToSection(schema, moving, target.id, index);
  }
  return reorderField(schema, active.id, over.id);
}
