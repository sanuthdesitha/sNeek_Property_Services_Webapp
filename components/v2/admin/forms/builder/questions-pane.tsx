"use client";

/**
 * Centre pane, as drawn: the selected section's heading with its question
 * count, "Select all" and "Collapse all", the section's settings, its
 * questions (sortable; drop on an outline section to move), and the bulk bar
 * for selected questions: Move to section, Copy to other forms, Duplicate,
 * Save as block, Delete.
 */
import * as React from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EBulkBar } from "@/components/v2/ui/bulk-bar";
import { fieldDragId } from "@/lib/forms/builder-dnd";
import type { BadgeContext } from "@/lib/forms/question-badges";
import type { FormSection } from "@/lib/forms/types";
import type { ConditionSourceField } from "./condition-editor";
import { QuestionRow, type RowAction } from "./question-row";
import { SectionSettings } from "./section-settings";

export type BulkAction = "move" | "copy" | "duplicate" | "block" | "delete";

export function QuestionsPane({
  section,
  sectionIndex,
  sectionCount,
  badgeContext,
  conditionFields,
  selectedIds,
  focusedId,
  disabled,
  onSelectAll,
  onToggle,
  onFocus,
  onClearSelection,
  onRowAction,
  onBulk,
  onSectionChange,
  onSectionMove,
  onSectionDuplicate,
  onSectionRemove,
}: {
  section: FormSection | null;
  sectionIndex: number;
  sectionCount: number;
  badgeContext: BadgeContext;
  conditionFields: ConditionSourceField[];
  selectedIds: string[];
  focusedId: string | null;
  disabled: boolean;
  onSelectAll: (checked: boolean) => void;
  onToggle: (fieldId: string) => void;
  onFocus: (fieldId: string) => void;
  onClearSelection: () => void;
  onRowAction: (fieldId: string, action: RowAction) => void;
  onBulk: (action: BulkAction) => void;
  onSectionChange: (patch: (section: FormSection) => FormSection, coalesceKey?: string) => void;
  onSectionMove: (direction: -1 | 1) => void;
  onSectionDuplicate: () => void;
  onSectionRemove: () => void;
}) {
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const sectionId = section?.id ?? null;
  // A different section starts collapsed.
  React.useEffect(() => setExpanded(new Set()), [sectionId]);

  if (!section) {
    return (
      <section aria-label="Questions" className="flex min-w-0 flex-1 flex-col gap-2.5 rounded-[12px] border border-dashed border-[hsl(var(--e-border-strong))] p-6 text-center">
        <h2 className="text-[1rem] font-[600]">No section selected</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Add a section in the outline to start adding questions.</p>
      </section>
    );
  }
  const ids = section.fields.map((field) => field.id);
  const selectedHere = ids.filter((id) => selectedIds.includes(id));
  const allSelected = ids.length > 0 && selectedHere.length === ids.length;
  const anyExpanded = expanded.size > 0;

  return (
    <section aria-label="Questions" className="flex min-w-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="e-display-sm min-w-0 break-words text-[1.25rem]">{section.title || "Untitled section"}</h2>
        <EPill>
          {section.fields.length} question{section.fields.length === 1 ? "" : "s"}
        </EPill>
        <span className="grow" />
        <label className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] max-sm:min-h-11">
          <input
            type="checkbox"
            className="size-[15px] accent-[hsl(var(--e-primary))]"
            checked={allSelected}
            disabled={ids.length === 0}
            onChange={(event) => onSelectAll(event.target.checked)}
          />
          Select all
        </label>
        <button
          type="button"
          onClick={() => setExpanded(anyExpanded ? new Set() : new Set(ids))}
          disabled={ids.length === 0}
          className="inline-flex h-7 items-center rounded-full border max-sm:h-11 max-sm:px-3.5 border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.75rem] font-[500] text-[hsl(var(--e-text-secondary))] disabled:opacity-50"
        >
          {anyExpanded ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <SectionSettings
        key={section.id}
        section={section}
        conditionFields={conditionFields.filter((source) => !ids.includes(source.id))}
        isFirst={sectionIndex === 0}
        isLast={sectionIndex === sectionCount - 1}
        disabled={disabled}
        onChange={onSectionChange}
        onMove={onSectionMove}
        onDuplicate={onSectionDuplicate}
        onRemove={onSectionRemove}
      />
      {section.fields.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[hsl(var(--e-border-strong))] px-3 py-6 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
          No questions in this section yet. Add one from “Add a question”, insert a saved block, or drag questions here from the outline.
        </p>
      ) : null}
      <SortableContext items={ids.map(fieldDragId)} strategy={verticalListSortingStrategy}>
        {/* A size container: each row picks its layout from the list's width (question-row.tsx). */}
        <ul className="flex flex-col gap-2 [container-type:inline-size]" data-question-list="">
          {section.fields.map((field, index) => (
            <QuestionRow
              key={field.id}
              field={field}
              badgeContext={badgeContext}
              checked={selectedIds.includes(field.id)}
              focused={focusedId === field.id && selectedIds.length <= 1}
              expanded={expanded.has(field.id)}
              isFirst={index === 0}
              isLast={index === section.fields.length - 1}
              onToggleCheck={() => onToggle(field.id)}
              onFocus={() => onFocus(field.id)}
              onToggleExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(field.id)) next.delete(field.id);
                  else next.add(field.id);
                  return next;
                })
              }
              onAction={(action) => onRowAction(field.id, action)}
            />
          ))}
        </ul>
      </SortableContext>
      <EBulkBar count={selectedIds.length} noun={{ one: "question", many: "questions" }} onClear={onClearSelection} busy={disabled}>
        <EButton variant="outline" size="sm" className="border-[hsl(158_15%_34%)] bg-transparent text-inherit" onClick={() => onBulk("move")}>Move to section</EButton>
        <EButton variant="outline" size="sm" className="border-[hsl(158_15%_34%)] bg-transparent text-inherit" onClick={() => onBulk("copy")}>Copy to other forms</EButton>
        <EButton variant="outline" size="sm" className="border-[hsl(158_15%_34%)] bg-transparent text-inherit" onClick={() => onBulk("duplicate")}>Duplicate</EButton>
        <EButton variant="outline" size="sm" className="border-[hsl(158_15%_34%)] bg-transparent text-inherit" onClick={() => onBulk("block")}>Save as block</EButton>
        <EButton variant="outline" size="sm" className="border-[hsl(158_15%_34%)] bg-transparent text-inherit" onClick={() => onBulk("delete")}>Delete</EButton>
      </EBulkBar>
    </section>
  );
}
