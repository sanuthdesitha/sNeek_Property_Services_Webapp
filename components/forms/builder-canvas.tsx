"use client";

import * as React from "react";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Camera,
  ChevronDown,
  Copy,
  FileText,
  GripVertical,
  Plus,
  Trash2,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { isUploadFieldType } from "@/lib/forms/field-types";
import {
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  isTemplateNodeVisible,
} from "@/lib/forms/visibility";
import type { FormField, FormSchema, FormSection } from "@/lib/forms/types";
import { FieldRenderer } from "./field-renderer";
import { FieldReferences } from "./field-references";
import { FormThemeScope, ThemedSectionHeading } from "./form-theme";

export interface BuilderCanvasProps {
  schema: FormSchema;
  selectedFieldId: string | null;
  collapsedSections: Set<string>;
  onSelectField: (fieldId: string | null) => void;
  onToggleSection: (sectionId: string) => void;
  onUpdateSectionTitle: (sectionId: string, title: string) => void;
  onUpdateSectionDescription: (sectionId: string, description: string) => void;
  onAddSection: () => void;
  onRemoveSection: (sectionId: string) => void;
  onDuplicateSection: (sectionId: string) => void;
  onAddFieldToSection: (sectionId: string) => void;
  onRemoveField: (sectionId: string, fieldId: string) => void;
  onDuplicateField: (sectionId: string, fieldId: string) => void;
}

/**
 * Live, what-you-see-is-what-the-cleaner-gets canvas. Each section and each
 * top-level field is wrapped in a selectable + sortable shell, but the field
 * body itself is rendered with the EXACT same FieldRenderer / upload tile the
 * cleaner job page uses (mirrors form-preview.tsx). Local `answers` state lets
 * conditions / sub-fields / "details when No" exercise live while editing.
 *
 * Selecting a field opens it in the right-hand properties panel; dragging a
 * field re-orders it within or across sections (DnD context lives in the
 * parent FormBuilder).
 */
export function BuilderCanvas(props: BuilderCanvasProps) {
  const { schema, onAddSection } = props;
  const [answers, setAnswers] = React.useState<Record<string, unknown>>({});
  const property = React.useMemo(() => ({ hasBalcony: true }), []);
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];

  return (
    <FormThemeScope theme={schema?.theme} className="mx-auto max-w-2xl space-y-4">
      {sections.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
          <p className="font-medium">Your form is empty</p>
          <p className="mt-1">Add a section, then drag field types from the left.</p>
        </div>
      ) : null}

      <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        {sections.map((section) => (
          <CanvasSection
            key={section.id}
            section={section}
            answers={answers}
            property={property}
            onAnswer={(fieldId, value) => setAnswers((prev) => ({ ...prev, [fieldId]: value }))}
            {...props}
          />
        ))}
      </SortableContext>

      <Button variant="outline" className="w-full border-dashed" onClick={onAddSection}>
        <Plus className="mr-1.5 size-4" /> Add section
      </Button>
    </FormThemeScope>
  );
}

function CanvasSection({
  section,
  answers,
  property,
  onAnswer,
  selectedFieldId,
  collapsedSections,
  onSelectField,
  onToggleSection,
  onUpdateSectionTitle,
  onUpdateSectionDescription,
  onRemoveSection,
  onDuplicateSection,
  onAddFieldToSection,
  onRemoveField,
  onDuplicateField,
}: BuilderCanvasProps & {
  section: FormSection;
  answers: Record<string, unknown>;
  property: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    data: { kind: "section", sectionId: section.id },
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Empty-section / between-field drop target so a dragged field can land here.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `section-drop:${section.id}`,
    data: { kind: "section-drop", sectionId: section.id },
  });

  const collapsed = collapsedSections.has(section.id);
  const sectionHidden = !isTemplateNodeVisible(section, answers, property);

  // Mirror form-preview: flatten sub-fields, filter by visibility for the body.
  const visibleFlat = flattenFieldsOneLevel(section.fields).filter((f) =>
    isFlattenedFieldVisible(f, answers, property),
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group/section rounded-2xl border border-border bg-surface shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground"
          aria-label="Drag section"
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => onToggleSection(section.id)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "Expand section" : "Collapse section"}
        >
          <ChevronDown className={`size-4 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
        </button>
        <Input
          value={section.title}
          onChange={(e) => onUpdateSectionTitle(section.id, e.target.value)}
          className="flex-1 border-transparent bg-transparent px-1 text-base font-semibold shadow-none focus-visible:border-input focus-visible:bg-background"
          placeholder="Section title"
          aria-label="Section title"
        />
        {sectionHidden ? <StatusPill variant="neutral">Conditional</StatusPill> : null}
        <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
          {section.fields.length} fields
        </span>
        <Button variant="ghost" size="icon" onClick={() => onDuplicateSection(section.id)} aria-label="Duplicate section">
          <Copy className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onRemoveSection(section.id)} aria-label="Remove section">
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </div>

      {!collapsed && (
        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <ThemedSectionHeading title={section.title || "Section"} description={section.description} />
            <Input
              value={section.description ?? ""}
              onChange={(e) => onUpdateSectionDescription(section.id, e.target.value)}
              className="h-8 border-transparent bg-transparent px-1 text-xs text-muted-foreground shadow-none focus-visible:border-input focus-visible:bg-background"
              placeholder="Add a section description (optional)"
              aria-label="Section description"
            />
          </div>

          <div ref={setDropRef} className={`space-y-2 rounded-xl ${isOver ? "bg-primary-soft/60 ring-2 ring-primary/40" : ""}`}>
            <SortableContext items={section.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {section.fields.map((field) => (
                <CanvasField
                  key={field.id}
                  field={field}
                  sectionId={section.id}
                  selected={field.id === selectedFieldId}
                  hidden={!visibleFlat.some((vf) => vf.id === field.id && !vf._isChild)}
                  answers={answers}
                  onAnswer={onAnswer}
                  onSelect={() => onSelectField(field.id)}
                  onRemove={() => onRemoveField(section.id, field.id)}
                  onDuplicate={() => onDuplicateField(section.id, field.id)}
                />
              ))}
            </SortableContext>

            {section.fields.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed p-6 text-center text-xs text-muted-foreground">
                Drag a field type here, or use the button below.
              </div>
            ) : null}
          </div>

          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onAddFieldToSection(section.id)}>
            <Plus className="mr-1 size-4" /> Add field
          </Button>
        </div>
      )}
    </div>
  );
}

function CanvasField({
  field,
  sectionId,
  selected,
  hidden,
  answers,
  onAnswer,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  field: FormField;
  sectionId: string;
  selected: boolean;
  hidden: boolean;
  answers: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id: field.id,
    data: { kind: "field", sectionId, fieldId: field.id },
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isOver ? <div className="absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-primary" aria-hidden /> : null}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`group/field relative cursor-pointer rounded-xl border bg-background p-3 pl-9 transition-colors ${
          selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
        } ${hidden ? "opacity-60" : ""}`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab text-muted-foreground/60 opacity-0 transition-opacity group-hover/field:opacity-100"
          aria-label="Drag field"
        >
          <GripVertical className="size-4" />
        </button>

        {/* hover toolbar */}
        <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/field:opacity-100">
          {hidden ? <StatusPill variant="neutral" size="sm">Hidden now</StatusPill> : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            aria-label="Duplicate field"
          >
            <Copy className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Delete field"
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>

        {/* The real rendered field — exactly what the cleaner sees. */}
        <div className="pointer-events-none select-none">
          <FieldBody field={field} answers={answers} onAnswer={onAnswer} />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders one top-level field (and its visible sub-fields) the way the cleaner
 * sees it — reusing FieldRenderer for inputs and the dashed capture tile for
 * uploads, identical to form-preview.tsx.
 */
function FieldBody({
  field,
  answers,
  onAnswer,
}: {
  field: FormField;
  answers: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
}) {
  // Flatten just this field so its visible children render indented under it,
  // matching the cleaner flow.
  const entries = flattenFieldsOneLevel([field]);
  return (
    <div className="space-y-2">
      {entries.map((entry: any) =>
        isUploadFieldType(entry.type) ? (
          <UploadTile key={entry.id} field={entry} />
        ) : (
          <FieldRenderer key={entry.id} field={entry} answers={answers} onAnswer={onAnswer} />
        ),
      )}
    </div>
  );
}

function UploadTile({ field }: { field: any }) {
  return (
    <div className={`space-y-1 ${field._isChild ? "ml-4 border-l-2 border-border pl-3" : ""}`}>
      <p className="text-xs font-medium text-muted-foreground">
        {field.label}
        {field.required ? " *" : ""}
        {field.locationTag ? ` · ${field.locationTag}` : ""}
      </p>
      <FieldReferences references={field.references} />
      <div className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-2 text-xs text-muted-foreground">
        {field.type === "video" ? (
          <Video className="size-5" />
        ) : field.type === "file" ? (
          <FileText className="size-5" />
        ) : (
          <Camera className="size-5" />
        )}
        {field.type === "video"
          ? "Video upload"
          : field.type === "file"
            ? "File upload"
            : `Photo upload${field.minPhotos ? ` · min ${field.minPhotos}` : ""}`}
      </div>
    </div>
  );
}
