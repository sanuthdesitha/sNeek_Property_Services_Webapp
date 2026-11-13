"use client";

/**
 * One question in the centre pane, as drawn: drag handle, checkbox, type,
 * wording and the badges the schema really drives. Clicking the wording
 * selects just this question; the checkbox adds it to a multi-selection.
 * The row menu is the keyboard alternative to dragging.
 */
import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { ChevronDown, GripVertical } from "lucide-react";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { fieldDragId } from "@/lib/forms/builder-dnd";
import { questionBadges, questionTypeLabel, type BadgeContext } from "@/lib/forms/question-badges";
import type { FormField } from "@/lib/forms/types";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import { cn } from "@/lib/utils";
import { DIVIDER_LABEL } from "./blocks";

export type RowAction = "edit" | "up" | "down" | "move" | "duplicate" | "copy" | "block" | "delete";

/*
 * A question row has two layouts, chosen by the width of the question list
 * (a CSS container query on the list, questions-pane.tsx), not the viewport:
 *
 *  - narrow list (a phone, or the centre pane of the three-pane layout at
 *    1280px): a two-line card on a five-column grid, handle · checkbox ·
 *    type · badges · menu. Line 1: handle, checkbox, the wording (spanning the
 *    type and badges columns, up to three lines) and "⋯". Line 2: type, badges
 *    and the expand button under the menu. The wording can never be squeezed
 *    to a sliver by the badges.
 *  - list of 34rem or more: the one-line row as drawn (handle, checkbox, type,
 *    wording, badges, expand, menu), unchanged; grid placement is ignored by
 *    flex layout.
 *
 * On a phone every control is a 44px target (`max-sm:`).
 */
const ROW_LAYOUT =
  "grid grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-0 max-sm:gap-x-1 " +
  "[@container(min-width:34rem)]:flex [@container(min-width:34rem)]:flex-nowrap [@container(min-width:34rem)]:gap-2.5";

function Details({ field }: { field: FormField }) {
  const lines: string[] = [];
  if (field.helpText) lines.push(stripHtmlToText(field.helpText));
  if (field.options?.length) lines.push(`Options: ${field.options.join(", ")}${field.allowOther ? ", Other" : ""}`);
  if (field.children?.length) lines.push(`Sub-questions: ${field.children.map((child) => child.label).join(", ")}`);
  if (field.instructions) lines.push("Has how-to instructions");
  if (field.references?.length) lines.push(`${field.references.length} example${field.references.length === 1 ? "" : "s"}`);
  if (lines.length === 0) lines.push("No extra settings.");
  return (
    <ul className="mt-1 space-y-0.5 pl-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))] [@container(min-width:34rem)]:pl-[7.5rem]">
      {lines.map((line) => (
        <li key={line} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

export function QuestionRow({
  field,
  badgeContext,
  checked,
  focused,
  expanded,
  isFirst,
  isLast,
  onToggleCheck,
  onFocus,
  onToggleExpand,
  onAction,
}: {
  field: FormField;
  badgeContext: BadgeContext;
  checked: boolean;
  focused: boolean;
  expanded: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleCheck: () => void;
  onFocus: () => void;
  onToggleExpand: () => void;
  onAction: (action: RowAction) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: fieldDragId(field.id) });
  const badges = questionBadges(field, badgeContext);
  const never = badges.some((badge) => badge.key === "never");
  const label = field.label === DIVIDER_LABEL ? "Divider" : stripHtmlToText(field.label) || "Untitled question";
  const items: ERowMenuItem[] = [
    { key: "edit", label: "Edit settings", onSelect: () => onAction("edit") },
    { key: "up", label: "Move up", onSelect: () => onAction("up"), disabled: isFirst },
    { key: "down", label: "Move down", onSelect: () => onAction("down"), disabled: isLast },
    { key: "move", label: "Move to section…", onSelect: () => onAction("move") },
    { key: "duplicate", label: "Duplicate", onSelect: () => onAction("duplicate"), separated: true },
    { key: "copy", label: "Copy to other forms…", onSelect: () => onAction("copy") },
    { key: "block", label: "Save as block…", onSelect: () => onAction("block") },
    { key: "delete", label: "Delete", danger: true, separated: true, onSelect: () => onAction("delete") },
  ];
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn(
        "rounded-[10px] border bg-[hsl(var(--e-surface))] px-3 py-2 max-sm:px-1 max-sm:py-1",
        checked || focused ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.07)]" : never ? "border-[hsl(var(--e-danger)/0.45)]" : "border-[hsl(var(--e-border))]",
        isDragging ? "opacity-60 shadow-[var(--e-elevation-2)]" : null,
      )}
    >
      <div className={ROW_LAYOUT} data-question-row-layout="">
        <button
          type="button"
          className="col-start-1 row-start-1 cursor-grab touch-none rounded p-0.5 text-[hsl(var(--e-border-strong))] focus-visible:outline focus-visible:outline-2 max-sm:flex max-sm:size-11 max-sm:items-center max-sm:justify-center"
          aria-label={`Drag "${label}". Press space to pick up, arrow keys to move, or drop on a section in the outline.`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <label className="col-start-2 row-start-1 flex items-center justify-center max-sm:size-11 [@container(min-width:34rem)]:contents">
          <input
            type="checkbox"
            className="size-[15px] shrink-0 accent-[hsl(var(--e-primary))] max-sm:size-5"
            checked={checked}
            onChange={onToggleCheck}
            aria-label={`Select "${label}"`}
          />
        </label>
        <span
          className="col-start-3 row-start-2 self-center text-[0.6875rem] font-[600] text-[hsl(var(--e-muted-foreground))] [@container(min-width:34rem)]:w-[76px] [@container(min-width:34rem)]:shrink-0"
          data-question-row-type=""
        >
          {questionTypeLabel(field)}
        </span>
        <button
          type="button"
          onClick={onFocus}
          aria-pressed={focused}
          data-question-row-label=""
          className={cn(
            "col-span-2 col-start-3 row-start-1 line-clamp-3 min-w-0 self-center break-words py-1 text-left text-[0.8125rem] max-sm:py-1.5 max-sm:text-[0.875rem]",
            "[@container(min-width:34rem)]:line-clamp-none [@container(min-width:34rem)]:min-w-[7.5rem] [@container(min-width:34rem)]:flex-1 [@container(min-width:34rem)]:py-0",
            checked || focused ? "font-[600]" : null,
          )}
        >
          {label}
        </button>
        <span className="col-start-4 row-start-2 flex min-w-0 flex-wrap justify-start gap-1 self-center [@container(min-width:34rem)]:justify-end">
          {badges.map((badge) => (
            <EPill key={badge.key} tone={badge.tone} className="max-w-full whitespace-normal py-0.5 leading-tight">
              {badge.label}
            </EPill>
          ))}
        </span>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse "${label}"` : `Expand "${label}"`}
          className="col-start-5 row-start-2 justify-self-center rounded p-1 text-[hsl(var(--e-text-faint))] hover:bg-[hsl(var(--e-muted))] max-sm:flex max-sm:size-11 max-sm:items-center max-sm:justify-center"
        >
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
        <ERowMenu label={`More actions for "${label}"`} items={items} className="col-start-5 row-start-1 justify-self-center" />
      </div>
      {expanded ? <Details field={field} /> : null}
    </li>
  );
}
