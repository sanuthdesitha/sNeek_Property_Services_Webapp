"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldEditor } from "./field-editor";
import { FieldTypePicker } from "./field-type-picker";
import type {
  FormField,
  FormFieldType,
  FormSection,
} from "@/lib/forms/types";

export interface SectionEditorProps {
  section: FormSection;
  onUpdateTitle: (title: string) => void;
  onRemove: () => void;
  onAddField: (field: FormField) => void;
  onUpdateField: (field: FormField) => void;
  onRemoveField: (fieldId: string) => void;
  onReorderFields: (from: number, to: number) => void;
  availableFields?: Array<{ id: string; label: string }>;
}

export function SectionEditor({
  section,
  onUpdateTitle,
  onRemove,
  onAddField,
  onUpdateField,
  onRemoveField,
  onReorderFields,
  availableFields = [],
}: SectionEditorProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleFieldDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = section.fields.findIndex((f) => f.id === active.id);
    const to = section.fields.findIndex((f) => f.id === over.id);
    if (from === -1 || to === -1) return;
    onReorderFields(from, to);
  }

  return (
    <Card ref={setNodeRef} style={style} className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground"
          aria-label="Drag section"
        >
          <GripVertical className="size-4" />
        </button>
        <Input
          value={section.title}
          onChange={(e) => onUpdateTitle(e.target.value)}
          className="flex-1 text-base font-semibold"
          placeholder="Section title"
        />
        <span className="text-xs text-muted-foreground">
          {section.fields.length} fields
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label="Remove section"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleFieldDragEnd}
      >
        <SortableContext
          items={section.fields.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {section.fields.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No fields yet — pick a type below.
              </p>
            )}
            {section.fields.map((field) => (
              <FieldEditor
                key={field.id}
                field={field}
                onUpdate={onUpdateField}
                onRemove={() => onRemoveField(field.id)}
                availableFields={availableFields.filter((f) => f.id !== field.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-3">
        <FieldTypePicker
          onPick={(type) =>
            onAddField({
              id: `f-${Date.now()}`,
              type: type as FormFieldType,
              label: `New ${type} field`,
            })
          }
        />
      </div>
    </Card>
  );
}
