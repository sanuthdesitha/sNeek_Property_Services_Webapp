"use client";

/**
 * The lines table: optional property section rows (collapsible, with counts and
 * subtotals), sortable line rows and the inline "add a line" row. The table
 * scrolls inside its own labelled box, so it never widens the page at 390px.
 */
import { Fragment, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { EButton } from "@/components/v2/ui/primitives";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";
import { money } from "../invoice-model";
import { EditorLineRow } from "./editor-line-row";
import { reorderWithinSection, type LineSection } from "./line-sections";
import type { LineDraft, LineDrafts } from "./line-drafts";

const HEAD = "whitespace-nowrap border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-left text-[0.6875rem] font-[600] text-[hsl(var(--e-muted-foreground))]";
const NEW_INPUT =
  "h-11 min-w-0 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[1rem] " +
  "focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:opacity-60 sm:h-9 sm:text-[0.8125rem]";

export type EditorLinesProps = {
  sections: LineSection[];
  drafts: LineDrafts;
  invalid: Record<string, string>;
  editable: boolean;
  frozen: boolean;
  newLine: LineDraft;
  onDraft: (lineId: string, draft: LineDraft) => void;
  onNewLine: (draft: LineDraft) => void;
  onAddLine: () => void;
  onReorder: (lineIds: string[]) => void;
  onRefusedMove: (message: string) => void;
  onRemove: (line: EditorLine) => void;
  onRegroup: (line: EditorLine) => void;
};

function SectionRow({ section, open, onToggle }: { section: LineSection; open: boolean; onToggle: () => void }) {
  const count = section.lines.length;
  return (
    <tr>
      <td colSpan={7} className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-background))] px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-[600]">{section.title}</span>
          <span className="text-[hsl(var(--e-muted-foreground))]">
            · {count} {count === 1 ? "line" : "lines"} · <span className="e-tnum">{money(section.subtotal)}</span>
          </span>
          <EButton type="button" size="sm" variant="ghost" className="h-7 px-2 text-[0.75rem]" aria-expanded={open} onClick={onToggle}>
            {open ? "Hide lines" : `Show ${count} ${count === 1 ? "line" : "lines"}`}
          </EButton>
        </div>
      </td>
    </tr>
  );
}

function AddLineRow({ props }: { props: EditorLinesProps }) {
  const { newLine, frozen } = props;
  return (
    <tr>
      <td className="px-3 py-2" />
      <td className="px-3 py-2" colSpan={2}>
        <input
          className={`${NEW_INPUT} w-full`}
          aria-label="New line description"
          placeholder="Describe the charge"
          value={newLine.description}
          disabled={frozen}
          onChange={(event) => props.onNewLine({ ...newLine, description: event.target.value })}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <input
          className={`${NEW_INPUT} w-[4.5rem] text-right e-tnum`}
          inputMode="decimal"
          aria-label="New line quantity"
          value={newLine.quantity}
          disabled={frozen}
          onChange={(event) => props.onNewLine({ ...newLine, quantity: event.target.value })}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <input
          className={`${NEW_INPUT} w-[6rem] text-right e-tnum`}
          inputMode="decimal"
          aria-label="New line rate"
          placeholder="0.00"
          value={newLine.unitPrice}
          disabled={frozen}
          onChange={(event) => props.onNewLine({ ...newLine, unitPrice: event.target.value })}
        />
      </td>
      <td className="px-3 py-2" />
      <td className="px-1 py-2 text-right">
        <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={props.onAddLine}>
          Add
        </EButton>
      </td>
    </tr>
  );
}

export function EditorLines(props: EditorLinesProps) {
  const { sections, editable, frozen } = props;
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const total = sections.reduce((count, section) => count + section.lines.length, 0);
  const sortable = editable && total > 1;

  function toggle(key: string) {
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const next = reorderWithinSection(sections, String(event.active.id), String(event.over.id));
    if (next) props.onReorder(next);
    else if (event.active.id !== event.over.id) {
      props.onRefusedMove("Lines stay in their property section. The PDF orders the sections itself.");
    }
  }

  return (
    <div role="region" aria-label="Invoice lines table" tabIndex={0} className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <table className="w-full min-w-[44rem] border-collapse text-[0.8125rem]">
          <thead>
            <tr>
              <th className={`${HEAD} w-[2.25rem]`}>
                <span className="sr-only">Reorder</span>
              </th>
              <th className={HEAD}>Description</th>
              <th className={HEAD}>Date</th>
              <th className={`${HEAD} text-right`}>Qty</th>
              <th className={`${HEAD} text-right`}>Rate</th>
              <th className={`${HEAD} text-right`}>Amount</th>
              <th className={`${HEAD} w-[2.75rem]`}>
                <span className="sr-only">Line actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[hsl(var(--e-muted-foreground))]">
                  No lines yet.{editable ? " Add one below." : ""}
                </td>
              </tr>
            ) : null}
            {sections.map((section) => {
              const open = !closed.has(section.key);
              return (
                <Fragment key={section.key}>
                  {section.title ? <SectionRow section={section} open={open} onToggle={() => toggle(section.key)} /> : null}
                  {open ? (
                    <SortableContext items={section.lines.map((line) => line.id)} strategy={verticalListSortingStrategy}>
                      {section.lines.map((line) => (
                        <EditorLineRow
                          key={line.id}
                          line={line}
                          draft={props.drafts[line.id]}
                          editable={editable}
                          frozen={frozen}
                          sortable={sortable}
                          error={props.invalid[line.id] ?? null}
                          onDraft={(draft) => props.onDraft(line.id, draft)}
                          onRemove={() => props.onRemove(line)}
                          onRegroup={() => props.onRegroup(line)}
                        />
                      ))}
                    </SortableContext>
                  ) : null}
                </Fragment>
              );
            })}
            {editable ? <AddLineRow props={props} /> : null}
          </tbody>
        </table>
      </DndContext>
    </div>
  );
}
