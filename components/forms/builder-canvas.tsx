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
  Settings2,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import {
  FIELD_TYPES,
  FIELD_CATEGORY_LABELS,
  FIELD_CATEGORY_ORDER,
  getFieldTypeDef,
  isUploadFieldType,
} from "@/lib/forms/field-types";
import {
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  isTemplateNodeVisible,
} from "@/lib/forms/visibility";
import type { FormField, FormFieldType, FormSchema, FormSection } from "@/lib/forms/types";
import { DIVIDER_LABEL } from "./form-blocks";
import { FieldRenderer } from "./field-renderer";
import { FieldReferences } from "./field-references";
import { FieldIcon } from "./field-icon";
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
  /** Inline edits committed straight from the canvas (label/help/required/options). */
  onUpdateField: (sectionId: string, field: FormField) => void;
  /** Insert a new field of `type` at `index` within a section (from a + inserter). */
  onInsertField: (sectionId: string, type: FormFieldType, index: number) => void;
}

/**
 * Live, what-you-see-is-what-the-cleaner-gets canvas with TRUE inline editing —
 * each field's label, help text and (for choice fields) options are edited
 * directly on the card, Google-Forms / Wix style. A floating toolbar handles
 * duplicate / delete / required / advanced, drag re-orders, and "+" inserters
 * between blocks add new fields of any type. Deep config still lives in the
 * right-hand properties panel (opened via the ⚙ on a selected field).
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
          <p className="mt-1">Add a section, then click “+ Add field”, or drag a field type from the left.</p>
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
  onRemoveField,
  onDuplicateField,
  onUpdateField,
  onInsertField,
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
        <div className="space-y-2 p-4">
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

          <div ref={setDropRef} className={`space-y-1 rounded-xl ${isOver ? "bg-primary-soft/60 ring-2 ring-primary/40" : ""}`}>
            <InsertPoint onInsert={(type) => onInsertField(section.id, type, 0)} />
            <SortableContext items={section.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {section.fields.map((field, index) => (
                <React.Fragment key={field.id}>
                  <CanvasField
                    field={field}
                    sectionId={section.id}
                    selected={field.id === selectedFieldId}
                    hidden={!visibleFlat.some((vf) => vf.id === field.id && !vf._isChild)}
                    answers={answers}
                    onAnswer={onAnswer}
                    onSelect={() => onSelectField(field.id)}
                    onUpdate={(next) => onUpdateField(section.id, next)}
                    onRemove={() => onRemoveField(section.id, field.id)}
                    onDuplicate={() => onDuplicateField(section.id, field.id)}
                  />
                  <InsertPoint onInsert={(type) => onInsertField(section.id, type, index + 1)} />
                </React.Fragment>
              ))}
            </SortableContext>

            {section.fields.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed p-6 text-center text-xs text-muted-foreground">
                Drag a field type here, or use “+ Add field”.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A thin "+" affordance that, on click, reveals a categorized field-type picker
 * and inserts the chosen type at this position (Gutenberg/Wix style).
 */
function InsertPoint({ onInsert }: { onInsert: (type: FormFieldType) => void }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close field picker"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-1/2 top-full z-50 mt-1 w-72 -translate-x-1/2 rounded-xl border border-border bg-popover p-2 shadow-lg">
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {FIELD_CATEGORY_ORDER.map((category) => {
                const types = (Object.values(FIELD_TYPES) as Array<(typeof FIELD_TYPES)[FormFieldType]>).filter(
                  (d) => d.category === category,
                );
                if (types.length === 0) return null;
                return (
                  <div key={category}>
                    <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {FIELD_CATEGORY_LABELS[category]}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {types.map((d) => (
                        <button
                          key={d.type}
                          type="button"
                          onClick={() => {
                            onInsert(d.type as FormFieldType);
                            setOpen(false);
                          }}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent"
                        >
                          <FieldIcon name={d.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{d.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}

      <div className="group/insert relative flex h-3 items-center justify-center">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary/30 opacity-0 transition-opacity group-hover/insert:opacity-100" aria-hidden />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative z-10 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground opacity-0 shadow-sm transition-opacity hover:border-primary hover:text-primary group-hover/insert:opacity-100"
        >
          <Plus className="size-3" /> Add field
        </button>
      </div>
    </div>
  );
}

/** Borderless text editor that looks like plain text until focused. */
function InlineText({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 outline-none transition-colors placeholder:text-muted-foreground/60 hover:border-border focus:border-input focus:bg-background ${className ?? ""}`}
    />
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
  onUpdate,
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
  onUpdate: (field: FormField) => void;
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

  const def = getFieldTypeDef(field.type);
  const isDivider = field.type === "instruction" && field.label === DIVIDER_LABEL;
  const isInstruction = field.type === "instruction" && !isDivider;
  const isChoice = Boolean(def?.hasOptions); // select / multiselect / radio
  const canRequire = !isDivider && !isInstruction && field.type !== "instruction";

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isOver ? <div className="absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-primary" aria-hidden /> : null}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`group/field relative rounded-xl border bg-background p-3 pl-9 transition-colors ${
          selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
        } ${hidden ? "opacity-60" : ""}`}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-2 top-3 cursor-grab text-muted-foreground/60 opacity-0 transition-opacity group-hover/field:opacity-100"
          aria-label="Drag field"
        >
          <GripVertical className="size-4" />
        </button>

        {/* Floating block toolbar */}
        <div className="absolute right-2 top-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/field:opacity-100 data-[selected=true]:opacity-100" data-selected={selected}>
          {hidden ? <StatusPill variant="neutral" size="sm">Hidden now</StatusPill> : null}
          {canRequire ? (
            <Button
              variant="ghost"
              size="icon"
              className={`size-7 text-base font-semibold ${field.required ? "text-destructive" : "text-muted-foreground"}`}
              title={field.required ? "Required — click to make optional" : "Optional — click to require"}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ ...field, required: !field.required });
              }}
              aria-label="Toggle required"
            >
              *
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
            aria-label="Advanced settings"
            title="Advanced settings"
          >
            <Settings2 className="size-3.5" />
          </Button>
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

        {/* Inline-editable label + type chip */}
        <div className="flex items-start gap-2 pr-24">
          <InlineText
            value={field.label}
            onChange={(label) => onUpdate({ ...field, label })}
            placeholder={isInstruction ? "Heading / note" : "Question / label"}
            ariaLabel="Field label"
            className={`flex-1 font-medium ${isInstruction ? "text-sm" : "text-sm"}`}
          />
          {field.required && canRequire ? <span className="pt-1 text-destructive">*</span> : null}
        </div>

        {/* Inline-editable help text */}
        {!isDivider ? (
          <InlineText
            value={field.helpText ?? ""}
            onChange={(helpText) => onUpdate({ ...field, helpText: helpText || undefined })}
            placeholder="Add help text (optional)"
            ariaLabel="Help text"
            className="mt-0.5 text-xs text-muted-foreground"
          />
        ) : null}

        {/* Body / preview */}
        <div className="mt-2">
          {isDivider ? (
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> Divider <span className="h-px flex-1 bg-border" />
            </div>
          ) : isInstruction ? (
            <p className="text-[11px] italic text-muted-foreground">Shown to the cleaner as an info note.</p>
          ) : isChoice ? (
            <OptionsEditor field={field} onUpdate={onUpdate} />
          ) : (
            <div className="pointer-events-none select-none">
              <FieldBody field={field} answers={answers} onAnswer={onAnswer} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline option list editor for select / multiselect / radio fields. */
function OptionsEditor({ field, onUpdate }: { field: FormField; onUpdate: (f: FormField) => void }) {
  const options = field.options ?? [];
  const setOptions = (next: string[]) => onUpdate({ ...field, options: next });
  const marker =
    field.type === "multiselect"
      ? "rounded-[4px]"
      : field.type === "radio"
        ? "rounded-full"
        : "rounded-[4px] opacity-0"; // dropdown shows no marker

  return (
    <div className="space-y-1">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={`size-3.5 shrink-0 border border-muted-foreground/50 ${marker}`} aria-hidden />
          <InlineText
            value={opt}
            onChange={(v) => setOptions(options.map((o, idx) => (idx === i ? v : o)))}
            placeholder={`Option ${i + 1}`}
            ariaLabel={`Option ${i + 1}`}
            className="flex-1 text-sm"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOptions(options.filter((_, idx) => idx !== i));
            }}
            className="shrink-0 rounded-md p-1 text-muted-foreground/60 hover:text-destructive"
            aria-label="Remove option"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOptions([...options, `Option ${options.length + 1}`]);
        }}
        className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-medium text-primary hover:underline"
      >
        <Plus className="size-3.5" /> Add option
      </button>
    </div>
  );
}

/**
 * Renders one top-level field (and its visible sub-fields) the way the cleaner
 * sees it — reusing FieldRenderer for inputs and the dashed capture tile for
 * uploads, with the field's own label suppressed (the card edits it inline).
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
  const entries = flattenFieldsOneLevel([field]);
  return (
    <div className="space-y-2">
      {entries.map((entry: any) =>
        isUploadFieldType(entry.type) ? (
          <UploadTile key={entry.id} field={entry} hideLabel={!entry._isChild} />
        ) : (
          <FieldRenderer key={entry.id} field={entry} answers={answers} onAnswer={onAnswer} hideLabel={!entry._isChild} />
        ),
      )}
    </div>
  );
}

function UploadTile({ field, hideLabel }: { field: any; hideLabel?: boolean }) {
  return (
    <div className={`space-y-1 ${field._isChild ? "ml-4 border-l-2 border-border pl-3" : ""}`}>
      {!hideLabel ? (
        <p className="text-xs font-medium text-muted-foreground">
          {field.label}
          {field.required ? " *" : ""}
          {field.locationTag ? ` · ${field.locationTag}` : ""}
        </p>
      ) : null}
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
