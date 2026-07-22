"use client";

/**
 * ESTATE form builder — center canvas. Lists sections and their fields as
 * selectable rows with up/down reorder, duplicate and delete. Section title +
 * description are inline-editable; add-field / add-section actions live here.
 * Reorder is button-driven (no HTML5 drag-drop). Native Estate styling.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import type { FormField, FormFieldType, FormSchema } from "@/lib/forms/types";
import { getFieldTypeDef } from "@/lib/forms/field-types";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { EBadge } from "@/components/v2/ui/primitives";
import { isStandardSectionId } from "@/lib/forms/standard-sections";
import { DIVIDER_LABEL } from "./blocks";
import { EFieldIcon } from "./field-icon";

function IconBtn({
  onClick,
  disabled,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "rounded-[var(--e-radius-sm)] p-1.5 transition-colors disabled:opacity-30",
        danger
          ? "text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))]"
          : "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </button>
  );
}

function FieldRow({
  field,
  selected,
  isFirst,
  isLast,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}: {
  field: FormField;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const def = getFieldTypeDef(field.type);
  const isDivider = field.type === "instruction" && field.label === DIVIDER_LABEL;

  return (
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
      className={cn(
        "group flex items-center gap-2 rounded-[var(--e-radius)] border px-2.5 py-2 transition-colors",
        selected
          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft)/0.5)] shadow-[var(--e-elevation-1)]"
          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
      )}
    >
      <GripVertical className="size-4 shrink-0 text-[hsl(var(--e-text-faint))]" />
      <span className="flex size-6 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))] text-[hsl(var(--e-text-secondary))]">
        <EFieldIcon name={def?.icon} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
          {isDivider ? "Divider" : field.label || "Untitled field"}
        </p>
        <p className="truncate text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
          {def?.label ?? field.type}
          {field.required ? " · required" : ""}
          {field.conditional?.fieldId ? " · conditional" : ""}
          {field.children?.length ? ` · ${field.children.length} sub` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <IconBtn onClick={onMoveUp} disabled={isFirst} label="Move up">
          <ArrowUp className="size-3.5" />
        </IconBtn>
        <IconBtn onClick={onMoveDown} disabled={isLast} label="Move down">
          <ArrowDown className="size-3.5" />
        </IconBtn>
        <IconBtn onClick={onDuplicate} label="Duplicate field">
          <Copy className="size-3.5" />
        </IconBtn>
        <IconBtn onClick={onRemove} label="Delete field" danger>
          <Trash2 className="size-3.5" />
        </IconBtn>
      </div>
    </div>
  );
}

export function BuilderCanvas({
  schema,
  selectedFieldId,
  onSelectField,
  onUpdateSectionTitle,
  onUpdateSectionDescription,
  onAddSection,
  onRemoveSection,
  onDuplicateSection,
  onMoveSection,
  onAddField,
  onRemoveField,
  onDuplicateField,
  onMoveField,
}: {
  schema: FormSchema;
  selectedFieldId: string | null;
  onSelectField: (id: string | null) => void;
  onUpdateSectionTitle: (sectionId: string, title: string) => void;
  onUpdateSectionDescription: (sectionId: string, description: string) => void;
  onAddSection: () => void;
  onRemoveSection: (sectionId: string) => void;
  onDuplicateSection: (sectionId: string) => void;
  onMoveSection: (sectionId: string, dir: -1 | 1) => void;
  onAddField: (sectionId: string, type?: FormFieldType) => void;
  onRemoveField: (sectionId: string, fieldId: string) => void;
  onDuplicateField: (sectionId: string, fieldId: string) => void;
  onMoveField: (sectionId: string, fieldId: string, dir: -1 | 1) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {schema.sections.map((section, sIdx) => (
        <div
          key={section.id}
          className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4"
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              {isStandardSectionId(section.id) ? (
                <span title="Standard section — required evidence / sign-off. Content is fully editable.">
                  <EBadge tone="info" soft>
                    Standard
                  </EBadge>
                </span>
              ) : null}
              <EInput
                value={section.title}
                onChange={(e) => onUpdateSectionTitle(section.id, e.target.value)}
                placeholder="Section title"
                className="border-transparent bg-transparent px-0 text-[1rem] font-semibold focus:border-[hsl(var(--e-input))] focus:px-3"
                aria-label="Section title"
              />
              <EInput
                value={section.description ?? ""}
                onChange={(e) => onUpdateSectionDescription(section.id, e.target.value)}
                placeholder="Section description (optional)"
                className="h-8 border-transparent bg-transparent px-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] focus:border-[hsl(var(--e-input))] focus:px-3"
                aria-label="Section description"
              />
            </div>
            <div className="flex shrink-0 items-center">
              <IconBtn onClick={() => onMoveSection(section.id, -1)} disabled={sIdx === 0} label="Move section up">
                <ArrowUp className="size-4" />
              </IconBtn>
              <IconBtn onClick={() => onMoveSection(section.id, 1)} disabled={sIdx === schema.sections.length - 1} label="Move section down">
                <ArrowDown className="size-4" />
              </IconBtn>
              <IconBtn onClick={() => onDuplicateSection(section.id)} label="Duplicate section">
                <Copy className="size-4" />
              </IconBtn>
              <IconBtn onClick={() => onRemoveSection(section.id)} label="Delete section" danger>
                <Trash2 className="size-4" />
              </IconBtn>
            </div>
          </div>

          <div className="space-y-1.5">
            {section.fields.length === 0 ? (
              <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 py-4 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No fields yet — add one from the palette or below.
              </p>
            ) : (
              section.fields.map((field, fIdx) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  selected={selectedFieldId === field.id}
                  isFirst={fIdx === 0}
                  isLast={fIdx === section.fields.length - 1}
                  onSelect={() => onSelectField(field.id)}
                  onMoveUp={() => onMoveField(section.id, field.id, -1)}
                  onMoveDown={() => onMoveField(section.id, field.id, 1)}
                  onDuplicate={() => onDuplicateField(section.id, field.id)}
                  onRemove={() => onRemoveField(section.id, field.id)}
                />
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => onAddField(section.id)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 py-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-gold)/0.5)] hover:text-[hsl(var(--e-foreground))]"
          >
            <Plus className="size-3.5" /> Add field
          </button>
        </div>
      ))}

      <EButton variant="outline" onClick={onAddSection} className="w-full">
        <Plus className="size-4" /> Add section
      </EButton>
    </div>
  );
}
