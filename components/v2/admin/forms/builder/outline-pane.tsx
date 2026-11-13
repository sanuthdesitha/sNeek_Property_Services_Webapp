"use client";

/**
 * Left pane, as drawn: "Sections" with "+ Add", one row per section (drag
 * handle, title, per-room / property-rule badges, question count), then
 * "Add a question" (every registered question type) and "Insert saved block…".
 *
 * Section rows are sortable (pointer and keyboard) and are drop targets for
 * questions dragged from the centre pane.
 */
import * as React from "react";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripVertical } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { FIELD_CATEGORY_LABELS, FIELD_CATEGORY_ORDER, FIELD_TYPES } from "@/lib/forms/field-types";
import { sectionDragId } from "@/lib/forms/builder-dnd";
import { describePropertyCondition } from "@/lib/forms/property-conditions";
import { isPropertyFieldCondition, type FormFieldType, type FormSchema, type FormSection } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

function dragStyle(transform: { x: number; y: number } | null, transition: string | undefined): React.CSSProperties {
  return { transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition };
}

/** Per-room badge: a repeated section, or a room block the property checklist generated. */
export function sectionRepeatLabel(section: FormSection): string | null {
  if (section.repeatBy === "bedrooms") return "per bedroom";
  if (section.repeatBy === "bathrooms") return "per bathroom";
  const generated = section.fields.find((field) => /__(bed|bath)\d+$/.test(field.id));
  if (generated) return /__bed\d+$/.test(generated.id) ? "one bedroom (from checklist)" : "one bathroom (from checklist)";
  return null;
}

function OutlineRow({
  section,
  active,
  onSelect,
}: {
  section: FormSection;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: sectionDragId(section.id) });
  const repeat = sectionRepeatLabel(section);
  const propertyRule = isPropertyFieldCondition(section.conditional) ? describePropertyCondition(section.conditional) : null;
  return (
    <li
      ref={setNodeRef}
      style={dragStyle(transform, transition)}
      className={cn(
        "flex items-center gap-1.5 rounded-[6px] px-1.5 py-1.5 text-[0.78rem]",
        active ? "bg-[hsl(var(--e-primary)/0.1)] font-[600] text-[hsl(var(--e-primary))]" : "text-[hsl(var(--e-foreground))]",
        isOver && !isDragging ? "ring-2 ring-[hsl(var(--e-primary))]" : null,
        isDragging ? "opacity-60" : null,
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-0.5 text-[hsl(var(--e-border-strong))] focus-visible:outline focus-visible:outline-2"
        aria-label={`Drag section ${section.title}. Press space to pick up, arrow keys to move.`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
      <button type="button" onClick={onSelect} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-left">
        <span className="min-w-0 break-words">{section.title || "Untitled section"}</span>
        {repeat ? <EPill>{repeat}</EPill> : null}
        {propertyRule ? <EPill tone="warn" className="max-w-full whitespace-normal">if property has</EPill> : null}
      </button>
      <span className={cn("tabular-nums", active ? null : "text-[hsl(var(--e-muted-foreground))]")} aria-label={`${section.fields.length} questions`}>
        {section.fields.length}
      </span>
    </li>
  );
}

/** Short palette names, shared with the phone "Add a question" sheet. */
export const PALETTE_LABEL: Partial<Record<FormFieldType, string>> = {
  checkbox: "Tick",
  barcode: "Scan",
  instruction: "Note",
  select: "Choice (list)",
  radio: "Choice (buttons)",
};

export function OutlinePane({
  schema,
  activeSectionId,
  onSelectSection,
  onAddSection,
  onAddQuestion,
  onAddBlock,
  onInsertBlock,
  disabled,
}: {
  schema: FormSchema;
  activeSectionId: string | null;
  onSelectSection: (id: string) => void;
  onAddSection: () => void;
  onAddQuestion: (type: FormFieldType) => void;
  onAddBlock: (kind: "heading" | "divider") => void;
  onInsertBlock: () => void;
  disabled: boolean;
}) {
  return (
    <section aria-label="Outline" className="flex flex-col gap-1 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-3.5">
      <div className="flex items-center justify-between">
        <h2 className="e-eyebrow">Sections</h2>
        <EButton variant="ghost" size="sm" onClick={onAddSection} disabled={disabled}>
          + Add
        </EButton>
      </div>
      <SortableContext items={schema.sections.map((section) => sectionDragId(section.id))} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col gap-0.5">
          {schema.sections.map((section) => (
            <OutlineRow key={section.id} section={section} active={section.id === activeSectionId} onSelect={() => onSelectSection(section.id)} />
          ))}
        </ul>
      </SortableContext>
      {schema.sections.length === 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">No sections yet. Add one to start.</p>
      ) : null}
      <div className="my-1.5 h-px bg-[hsl(var(--e-border))]" />
      <h2 className="e-eyebrow">Add a question</h2>
      {FIELD_CATEGORY_ORDER.map((category) => (
        <div key={category} role="group" aria-label={FIELD_CATEGORY_LABELS[category]} className="flex flex-wrap gap-1.5">
          {Object.values(FIELD_TYPES)
            .filter((def) => def.category === category)
            .map((def) => (
              <button
                key={def.type}
                type="button"
                disabled={disabled || !activeSectionId}
                onClick={() => onAddQuestion(def.type)}
                className="inline-flex h-7 items-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.75rem] font-[500] text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] disabled:opacity-50"
              >
                {PALETTE_LABEL[def.type] ?? def.label}
              </button>
            ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={disabled || !activeSectionId} onClick={() => onAddBlock("heading")} className="inline-flex h-7 items-center rounded-full border border-dashed border-[hsl(var(--e-border-strong))] px-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))] disabled:opacity-50">
          Heading
        </button>
        <button type="button" disabled={disabled || !activeSectionId} onClick={() => onAddBlock("divider")} className="inline-flex h-7 items-center rounded-full border border-dashed border-[hsl(var(--e-border-strong))] px-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))] disabled:opacity-50">
          Divider
        </button>
      </div>
      <EButton variant="outline" size="sm" className="mt-1.5" onClick={onInsertBlock} disabled={disabled || !activeSectionId}>
        Insert saved block…
      </EButton>
    </section>
  );
}
