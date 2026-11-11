"use client";

/**
 * One invoice line as a table row: drag handle, description (with the job
 * link), date, quantity, rate, amount and the line menu.
 *
 * The handle is the only drag target, so clicking into a field never starts a
 * drag; with the keyboard, focus the handle, press Space, move with the arrow
 * keys and press Space again (dnd-kit KeyboardSensor). The amount shown is the
 * stored one: an unsaved change is marked, and totals update when it is saved,
 * so the screen never invents money arithmetic.
 */
import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";
import { fmtDay, money } from "../invoice-model";
import { draftDiffers, draftFromLine, type LineDraft } from "./line-drafts";

const CELL = "border-b border-[hsl(var(--e-border))] px-3 py-2 align-middle";
const INPUT =
  "h-11 min-w-0 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[1rem] " +
  "text-[hsl(var(--e-foreground))] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] " +
  "disabled:opacity-60 sm:h-9 sm:text-[0.8125rem]";

export type LineRowProps = {
  line: EditorLine;
  draft: LineDraft | undefined;
  editable: boolean;
  frozen: boolean;
  sortable: boolean;
  error: string | null;
  onDraft: (draft: LineDraft) => void;
  onRemove: () => void;
  onRegroup: () => void;
};

function LineBadges({ line }: { line: EditorLine }) {
  return (
    <>
      {line.shoppingLocked ? <EPill tone="gold">Shopping · locked</EPill> : null}
      {line.discount ? <EPill tone="info">{line.discountPercent !== null ? `Discount · ${line.discountPercent}%` : "Discount"}</EPill> : null}
      {line.startedWork === "unfinished" ? <EPill tone="warn">Started, not finished: review</EPill> : null}
      {line.startedWork === "changed" ? <EPill tone="warn">Changed since review</EPill> : null}
    </>
  );
}

function JobLink({ line }: { line: EditorLine }) {
  if (!line.job) return null;
  return (
    <Link
      href={`/v2/admin/jobs/${encodeURIComponent(line.job.id)}`}
      className="font-mono text-[0.75rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline"
    >
      {line.job.jobNumber ?? "Job"}
    </Link>
  );
}

function lineMenu(line: EditorLine, props: LineRowProps): ERowMenuItem[] {
  const items: ERowMenuItem[] = [];
  if (line.job) items.push({ key: "job", label: "Open job", href: `/v2/admin/jobs/${encodeURIComponent(line.job.id)}` });
  if (props.editable && !line.job && !line.shoppingLocked && !line.discount) {
    items.push({ key: "group", label: "Group under a property…", onSelect: props.onRegroup });
  }
  if (props.editable && !line.shoppingLocked) {
    items.push({ key: "remove", label: "Remove line…", danger: true, separated: items.length > 0, onSelect: props.onRemove });
  }
  return items;
}

export function EditorLineRow(props: LineRowProps) {
  const { line, draft, editable, frozen, sortable, error } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
    disabled: !sortable || frozen,
  });
  const value = draft ?? draftFromLine(line);
  const dirty = draftDiffers(line, draft);
  const menu = lineMenu(line, props);
  const label = line.description || "line";
  // A discount keeps the amount it was given; remove and re-add it to change it.
  const amountEditable = editable && !line.shoppingLocked && !line.discount;
  const errorId = error ? `line-error-${line.id}` : undefined;

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "relative z-10 bg-[hsl(var(--e-surface-raised))] shadow-lg", dirty && "bg-[hsl(var(--e-gold-soft)/0.35)]")}
    >
      <td className={cn(CELL, "w-[2.25rem] pr-0")}>
        {sortable ? (
          <button
            type="button"
            disabled={frozen}
            className="flex h-11 w-8 cursor-grab items-center justify-center rounded text-[hsl(var(--e-border-strong))] hover:text-[hsl(var(--e-muted-foreground))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))] active:cursor-grabbing disabled:cursor-not-allowed sm:h-8"
            aria-label={`Reorder ${label}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden className="h-4 w-4" />
          </button>
        ) : null}
      </td>
      <td className={cn(CELL, "min-w-[16rem]")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {editable ? (
            <input
              className={cn(INPUT, "w-full flex-1 basis-[12rem]")}
              aria-label={`Description of ${label}`}
              aria-invalid={error ? true : undefined}
              aria-describedby={errorId}
              value={value.description}
              disabled={frozen}
              onChange={(event) => props.onDraft({ ...value, description: event.target.value })}
            />
          ) : (
            <span className="break-words">{line.description}</span>
          )}
          <JobLink line={line} />
          <LineBadges line={line} />
        </div>
        {line.note ? <p className="mt-1 whitespace-pre-line text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{line.note}</p> : null}
        {error ? (
          <p id={errorId} role="alert" className="mt-1 text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">
            {error}
          </p>
        ) : null}
      </td>
      <td className={cn(CELL, "whitespace-nowrap e-tnum")}>{line.job ? fmtDay(line.job.scheduledDay) : "—"}</td>
      <td className={cn(CELL, "text-right e-tnum")}>
        {amountEditable ? (
          <input
            className={cn(INPUT, "w-[4.5rem] text-right")}
            inputMode="decimal"
            aria-label={`Quantity of ${label}`}
            value={value.quantity}
            disabled={frozen}
            onChange={(event) => props.onDraft({ ...value, quantity: event.target.value })}
          />
        ) : (
          line.quantity
        )}
      </td>
      <td className={cn(CELL, "text-right e-tnum")}>
        {amountEditable ? (
          <input
            className={cn(INPUT, "w-[6rem] text-right")}
            inputMode="decimal"
            aria-label={`Rate of ${label}`}
            value={value.unitPrice}
            disabled={frozen}
            onChange={(event) => props.onDraft({ ...value, unitPrice: event.target.value })}
          />
        ) : (
          line.unitPrice.toFixed(2)
        )}
      </td>
      <td className={cn(CELL, "whitespace-nowrap text-right e-tnum")}>
        {money(line.lineTotal)}
        {dirty ? <span className="block text-[0.6875rem] text-[hsl(var(--e-warning))]">Unsaved</span> : null}
      </td>
      <td className={cn(CELL, "w-[2.75rem] px-1 text-right")}>
        {menu.length ? <ERowMenu label={`Line actions for ${label}`} items={menu} disabled={frozen} /> : null}
      </td>
    </tr>
  );
}
