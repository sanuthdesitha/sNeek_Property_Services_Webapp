"use client";

/**
 * Selection (active section, focused question, multi-selection) and every
 * schema edit the builder offers, as named operations over the pure functions
 * in lib/forms/builder-ops.ts and lib/forms/multi-edit.ts. Selection that
 * points at something no longer in the document (after undo, delete or
 * restore) is dropped, so no panel ever edits a question that is gone.
 */
import * as React from "react";
import {
  defaultIdFactory,
  deleteFields,
  duplicateFields,
  insertFields,
  locateField,
  moveFieldBy,
  moveFieldsToSection,
  moveSectionBy,
  replaceField,
  updateSection,
  copyFieldsWithNewIds,
} from "@/lib/forms/builder-ops";
import { applyDrop } from "@/lib/forms/builder-dnd";
import { applyMultiEdit, type MultiEditPatch } from "@/lib/forms/multi-edit";
import { getFieldTypeDef } from "@/lib/forms/field-types";
import type { FormField, FormFieldType, FormSchema, FormSection } from "@/lib/forms/types";
import { DIVIDER_LABEL } from "./blocks";
import type { BuilderDocument } from "./use-builder-document";

export function makeField(type: FormFieldType): FormField {
  return {
    id: defaultIdFactory("field"),
    type,
    label: `New ${getFieldTypeDef(type)?.label ?? type} question`,
    ...(getFieldTypeDef(type)?.defaultConfig ?? {}),
  };
}

export type BuilderEditing = ReturnType<typeof useBuilderEditing>;

export function useBuilderEditing(document: BuilderDocument) {
  const schema = document.doc.schema;
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(schema.sections[0]?.id ?? null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const editSchema = document.editSchema;

  // Drop selection that no longer exists.
  React.useEffect(() => {
    if (activeSectionId && !schema.sections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(schema.sections[0]?.id ?? null);
    } else if (!activeSectionId && schema.sections[0]) setActiveSectionId(schema.sections[0].id);
    const live = new Set(schema.sections.flatMap((section) => section.fields.map((field) => field.id)));
    setSelectedIds((prev) => (prev.every((id) => live.has(id)) ? prev : prev.filter((id) => live.has(id))));
    setFocusedId((prev) => (prev && !live.has(prev) ? null : prev));
  }, [schema, activeSectionId]);

  const activeSection = schema.sections.find((section) => section.id === activeSectionId) ?? null;
  const sectionIndex = activeSection ? schema.sections.indexOf(activeSection) : -1;
  const selectedFields = schema.sections.flatMap((section) => section.fields.filter((field) => selectedIds.includes(field.id)));
  const editingIds = selectedIds.length > 0 ? selectedIds : focusedId ? [focusedId] : [];
  const focused = focusedId ? locateField(schema, focusedId) : null;

  const selectSection = (id: string) => {
    setActiveSectionId(id);
    setSelectedIds([]);
    setFocusedId(null);
  };
  const focus = (id: string) => {
    setSelectedIds([]);
    setFocusedId(id);
  };
  const toggle = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));
  const selectAll = (checked: boolean) => setSelectedIds(checked && activeSection ? activeSection.fields.map((field) => field.id) : []);

  const addSection = () => {
    const id = defaultIdFactory("section");
    editSchema((current) => ({ ...current, sections: [...current.sections, { id, title: "New section", fields: [] }] }));
    selectSection(id);
  };
  const addQuestion = (type: FormFieldType) => {
    if (!activeSection) return;
    const field = makeField(type);
    editSchema((current) => insertFields(current, activeSection.id, [field]));
    focus(field.id);
  };
  const addBlock = (kind: "heading" | "divider") => {
    if (!activeSection) return;
    const field: FormField =
      kind === "heading"
        ? { id: defaultIdFactory("field"), type: "instruction", label: "Section heading", helpText: "Add a short instruction or note here." }
        : { id: defaultIdFactory("field"), type: "instruction", label: DIVIDER_LABEL };
    editSchema((current) => insertFields(current, activeSection.id, [field]));
    focus(field.id);
  };
  const insertBlockFields = (fields: FormField[]) => {
    if (!activeSection) return;
    const copy = copyFieldsWithNewIds(fields);
    const next = insertFields(schema, activeSection.id, copy.fields);
    editSchema(() => next);
    setSelectedIds(copy.fields.map((field) => field.id));
    setNotice(`Inserted ${copy.fields.length} question${copy.fields.length === 1 ? "" : "s"} from the block.`);
  };
  const updateField = (fieldId: string, next: FormField) => {
    editSchema((current) => replaceField(current, fieldId, next), `field:${fieldId}`);
    if (next.id !== fieldId) setFocusedId(next.id);
  };
  const applyPatch = (patch: MultiEditPatch) => {
    const key = `multi:${Object.keys(patch).sort().join(",")}:${editingIds.join(",")}`;
    editSchema((current) => applyMultiEdit(current, editingIds, patch), key);
  };
  const moveTo = (ids: string[], sectionId: string) => {
    editSchema((current) => moveFieldsToSection(current, ids, sectionId));
    setNotice(`Moved ${ids.length} question${ids.length === 1 ? "" : "s"}.`);
  };
  // Discrete actions compute their result from the rendered schema (outside
  // the reducer), so new ids and notices are known here, deterministically.
  const duplicate = (ids: string[]) => {
    const result = duplicateFields(schema, ids);
    editSchema(() => result.schema);
    setSelectedIds(result.newIds);
  };
  const remove = (ids: string[]) => {
    const result = deleteFields(schema, ids);
    editSchema(() => result.schema);
    setSelectedIds([]);
    setFocusedId(null);
    const dangling = result.danglingRuleLabels;
    setNotice(
      dangling.length
        ? `Deleted. ${dangling.length} rule${dangling.length === 1 ? "" : "s"} (${dangling.slice(0, 3).join(", ")}) watched a deleted question and will never show — fix or Undo.`
        : `Deleted ${ids.length} question${ids.length === 1 ? "" : "s"}. Undo brings ${ids.length === 1 ? "it" : "them"} back.`,
    );
  };
  const moveBy = (id: string, direction: -1 | 1) => editSchema((current) => moveFieldBy(current, id, direction));
  const drop = (activeId: string | number, overId: string | number | null | undefined) =>
    editSchema((current: FormSchema) => applyDrop(current, activeId, overId, selectedIds));
  const changeSection = (patch: (section: FormSection) => FormSection, coalesceKey?: string) => {
    if (activeSection) editSchema((current) => updateSection(current, activeSection.id, patch), coalesceKey);
  };
  const moveSection = (direction: -1 | 1) => {
    if (activeSection) editSchema((current) => moveSectionBy(current, activeSection.id, direction));
  };
  const duplicateSection = () => {
    if (!activeSection) return;
    // Same as duplicating every question of the section in place, then moving
    // the copies into a new section right after it (rules kept or re-pointed).
    const id = defaultIdFactory("section");
    const duplicated = duplicateFields(schema, activeSection.fields.map((field) => field.id));
    const index = schema.sections.findIndex((section) => section.id === activeSection.id);
    const withSection: FormSchema = {
      ...duplicated.schema,
      sections: [
        ...duplicated.schema.sections.slice(0, index + 1),
        { ...(JSON.parse(JSON.stringify(activeSection)) as FormSection), id, title: `${activeSection.title} (copy)`, fields: [] },
        ...duplicated.schema.sections.slice(index + 1),
      ],
    };
    const moved = moveFieldsToSection(withSection, duplicated.newIds, id);
    // Copies of a whole section keep their labels (no "(copy)" per question).
    const labelled = updateSection(moved, id, (section) => ({
      ...section,
      fields: section.fields.map((field, fieldIndex) => ({ ...field, label: activeSection.fields[fieldIndex]?.label ?? field.label })),
    }));
    editSchema(() => labelled);
    selectSection(id);
  };
  const removeSection = (sectionId: string) => {
    editSchema((current) => ({ ...current, sections: current.sections.filter((section) => section.id !== sectionId) }));
  };

  return {
    schema,
    activeSection,
    sectionIndex,
    selectedIds,
    selectedFields,
    focusedId,
    focused,
    editingIds,
    notice,
    setNotice,
    selectSection,
    focus,
    toggle,
    selectAll,
    clearSelection: () => setSelectedIds([]),
    addSection,
    addQuestion,
    addBlock,
    insertBlockFields,
    updateField,
    applyPatch,
    moveTo,
    duplicate,
    remove,
    moveBy,
    drop,
    changeSection,
    moveSection,
    duplicateSection,
    removeSection,
  };
}
