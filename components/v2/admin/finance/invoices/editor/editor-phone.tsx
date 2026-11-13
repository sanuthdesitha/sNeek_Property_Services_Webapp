"use client";

/**
 * Phones only (below 640px): the invoice editor as drawn on the board "Admin
 * phone: Invoice editor" (2026-11). Layout and composition only; every change
 * still goes through the page's `useInvoiceEditor` (drafts, autosave, the
 * stale-write guard) and the existing invoice routes.
 *
 * - PhoneStageLine: the five stages as one thin line.
 * - PhoneHeaderFacts: bill to / period / due / GST collapsed to one line with
 *   "Edit", which opens the very same fields in a sheet.
 * - EditorLineCards: the lines as cards grouped by property (folding), each
 *   with the line's menu plus Move up / Move down, which save through the
 *   existing reorder save (`reorderWithinSection` → `onReorder`).
 * - PhoneLineSheet: Add a line, and Edit line. Amounts are never worked out
 *   here: "Worked out when saved" until the server returns the line.
 * - PhoneTotalBar: the server's total and the stage's button (Review, then
 *   Approve; Send once approved; otherwise the page's primary action).
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { EStage } from "@/components/v2/ui/stage-bar";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";
import { fmtDay, money } from "../invoice-model";
import { LineBadges, lineMenu } from "./editor-line-row";
import { savedItemGstNote } from "./add-line-row";
import { reorderWithinSection, type LineSection } from "./line-sections";
import { draftDiffers, draftFromLine, type LineDraft, type LineDrafts } from "./line-drafts";
import type { LineSuggestions } from "./use-line-suggestions";

/* ── Stage line ──────────────────────────────────────────────────────────── */

export function PhoneStageLine({ stages, terminal }: { stages: EStage[]; terminal: { title: string; description: string } | null }) {
  if (terminal) {
    return (
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:hidden">
        <span className="font-[600] text-[hsl(var(--e-foreground))]">{terminal.title}</span> · {terminal.description}
      </p>
    );
  }
  const currentIndex = stages.findIndex((stage) => stage.state === "current");
  return (
    <ol aria-label="Invoice stages" className="flex flex-wrap items-center gap-x-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] sm:hidden">
      {currentIndex >= 0 ? <li aria-hidden className="e-tnum mr-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--e-primary))] px-1.5 text-[0.6875rem] font-[650] text-[hsl(var(--e-primary-foreground))]">{currentIndex + 1}</li> : null}
      {stages.map((stage, index) => (
        <li key={stage.key} aria-current={stage.state === "current" ? "step" : undefined} className={cn(stage.state === "current" && "font-[650] text-[hsl(var(--e-foreground))]", stage.state === "skipped" && "line-through")}>
          {index > 0 ? <span aria-hidden>· </span> : null}
          {stage.label}
          {stage.note ? ` (${stage.note})` : null}
        </li>
      ))}
    </ol>
  );
}

/* ── Header facts ────────────────────────────────────────────────────────── */

export function PhoneHeaderFacts({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start justify-between gap-2 border-b border-[hsl(var(--e-border))] px-3.5 py-2.5 sm:hidden">
      <p className="min-w-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">{summary}</p>
      <EButton type="button" size="sm" variant="ghost" aria-haspopup="dialog" onClick={() => setOpen(true)}>Edit</EButton>
      <EBottomSheet open={open} onOpenChange={setOpen} title="Invoice details" footer={<EButton className="w-full" onClick={() => setOpen(false)}>Done</EButton>}>
        {open ? children : null}
      </EBottomSheet>
    </div>
  );
}

/* ── Line cards ──────────────────────────────────────────────────────────── */

export type EditorLineCardsProps = {
  sections: LineSection[];
  drafts: LineDrafts;
  invalid: Record<string, string>;
  editable: boolean;
  frozen: boolean;
  onReorder: (lineIds: string[]) => void;
  onRemove: (line: EditorLine) => void;
  onRegroup: (line: EditorLine) => void;
  onEdit: (line: EditorLine) => void;
};

/** Sections longer than this start folded on a phone ("Show 6 lines"). */
const FOLD_OVER = 4;

function moveItems(line: EditorLine, section: LineSection, props: EditorLineCardsProps, sortable: boolean): ERowMenuItem[] {
  if (!sortable) return [];
  const index = section.lines.findIndex((candidate) => candidate.id === line.id);
  const previous = section.lines[index - 1];
  const next = section.lines[index + 1];
  const move = (overId: string) => {
    const order = reorderWithinSection(props.sections, line.id, overId);
    if (order) props.onReorder(order);
  };
  return [
    { key: "up", label: "Move up", separated: true, disabled: !previous, hint: previous ? undefined : "Already first in this section", onSelect: () => previous && move(previous.id) },
    { key: "down", label: "Move down", disabled: !next, hint: next ? undefined : "Already last in this section", onSelect: () => next && move(next.id) },
  ];
}

function LineCard({ line, section, props, sortable }: { line: EditorLine; section: LineSection; props: EditorLineCardsProps; sortable: boolean }) {
  const draft = props.drafts[line.id];
  const dirty = draftDiffers(line, draft);
  const value = draft ?? draftFromLine(line);
  const error = props.invalid[line.id] ?? null;
  const label = line.description || "line";
  const items: ERowMenuItem[] = [];
  if (props.editable) items.push({ key: "edit", label: "Edit line…", onSelect: () => props.onEdit(line) });
  items.push(...lineMenu(line, { editable: props.editable, onRegroup: () => props.onRegroup(line), onRemove: () => props.onRemove(line) }));
  items.push(...moveItems(line, section, props, sortable));
  const date = line.job ? fmtDay(line.job.scheduledDay) : null;
  return (
    <li data-line-card={line.id} className={cn("px-3.5 py-3", dirty && "bg-[hsl(var(--e-gold-soft)/0.35)]")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-[600] [overflow-wrap:anywhere]">
            {value.description || line.description}
            {line.job ? (
              <>
                {" · "}
                <Link href={`/v2/admin/jobs/${encodeURIComponent(line.job.id)}`} className="font-mono text-[0.75rem] font-[500] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
                  {line.job.jobNumber ?? "Job"}
                </Link>
              </>
            ) : null}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5"><LineBadges line={line} /></div>
        </div>
        {items.length > 0 ? <ERowMenu label={`Line actions for ${label}`} items={items} disabled={props.frozen} /> : null}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem]">
        <span className="e-tnum min-w-0 text-[hsl(var(--e-muted-foreground))]">
          {[date, `${line.quantity} × ${money(line.unitPrice)}`].filter(Boolean).join(" · ")}
        </span>
        <span className="e-tnum shrink-0 font-[600]">{money(line.lineTotal)}</span>
      </div>
      {dirty ? (
        <p className="e-tnum mt-0.5 text-[0.75rem] text-[hsl(var(--e-warning))]">
          Unsaved: {value.quantity} × {value.unitPrice}. The amount is worked out when saved.
        </p>
      ) : null}
      {line.note ? <p className="mt-1 whitespace-pre-line text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{line.note}</p> : null}
      {error ? <p role="alert" className="mt-1 text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </li>
  );
}

export function EditorLineCards(props: EditorLineCardsProps) {
  const { sections, editable } = props;
  const total = sections.reduce((count, section) => count + section.lines.length, 0);
  const sortable = editable && total > 1;
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (total === 0) {
    return <p className="px-3.5 py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No lines yet.{editable ? " Add one below." : ""}</p>;
  }
  return (
    <div className="divide-y divide-[hsl(var(--e-border))]" data-line-cards="">
      {sections.map((section) => {
        const count = section.lines.length;
        const isOpen = open[section.key] ?? !(section.title && count > FOLD_OVER);
        const toggle = () => setOpen((previous) => ({ ...previous, [section.key]: !isOpen }));
        return (
          <section key={section.key} aria-label={section.title ?? "Lines"}>
            {section.title ? (
              <div className="flex items-center justify-between gap-2 bg-[hsl(var(--e-background))] px-3.5 py-2">
                <p className="min-w-0 text-[0.8125rem]">
                  <span className="font-[650] [overflow-wrap:anywhere]">{section.title}</span>{" "}
                  <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">· {count} {count === 1 ? "line" : "lines"} · {money(section.subtotal)}</span>
                </p>
                <EButton type="button" size="sm" variant="ghost" aria-expanded={isOpen} onClick={toggle}>
                  {isOpen ? "Hide lines" : `Show ${count} ${count === 1 ? "line" : "lines"}`}
                </EButton>
              </div>
            ) : null}
            {isOpen ? (
              <ul className="divide-y divide-[hsl(var(--e-border))]">
                {section.lines.map((line) => <LineCard key={line.id} line={line} section={section} props={props} sortable={sortable} />)}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/* ── Add / edit line sheet ───────────────────────────────────────────────── */

const SHEET_INPUT =
  "h-11 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[1rem] " +
  "focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:opacity-60";

export type PhoneLineSheetTarget = { mode: "add" } | { mode: "edit"; line: EditorLine };

type LineSheetProps = {
  target: PhoneLineSheetTarget;
  /** "add": the page's new-line draft (kept when the sheet closes). */
  newLine: LineDraft;
  /** "edit": the line's current draft, if any. */
  drafts: LineDrafts;
  suggestions: LineSuggestions | null;
  gstEnabled: boolean;
  frozen: boolean;
  inputsFrozen: boolean;
  /** Set while the last "Add line" is refused, with the server's words. */
  failure: string | null;
  onNewLine: (draft: LineDraft) => void;
  onAddLine: () => void;
  onDraft: (lineId: string, draft: LineDraft) => void;
  onClose: () => void;
};

export function PhoneLineSheet(props: LineSheetProps) {
  const { target, frozen, inputsFrozen } = props;
  const formId = useId();
  const editing = target.mode === "edit" ? target.line : null;
  const [editDraft, setEditDraft] = useState<LineDraft>(() => (editing ? props.drafts[editing.id] ?? draftFromLine(editing) : props.newLine));
  const [gstNote, setGstNote] = useState<string | null>(null);
  const value = editing ? editDraft : props.newLine;
  const setValue = (next: LineDraft) => (editing ? setEditDraft(next) : props.onNewLine(next));
  const amountLocked = Boolean(editing && (editing.shoppingLocked || editing.discount));

  // "Add line": close once the server has taken it (the page clears the draft).
  const submitted = useRef(false);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    if (!editing && submitted.current && !frozen && props.newLine.description === "") close.current();
  }, [editing, frozen, props.newLine.description]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (frozen) return;
    if (editing) {
      props.onDraft(editing.id, editDraft);
      props.onClose();
      return;
    }
    submitted.current = true;
    props.onAddLine();
  }

  const items = props.suggestions?.savedItems;
  return (
    <EBottomSheet
      open
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      busy={!editing && frozen && submitted.current}
      title={editing ? "Edit line" : "Add a line"}
      footer={(
        <>
          <EButton type="button" variant="outline" className="flex-1" onClick={props.onClose} disabled={!editing && frozen && submitted.current}>Cancel</EButton>
          <EButton type="submit" form={formId} className="flex-1" disabled={frozen}>{editing ? "Keep changes" : frozen && submitted.current ? "Adding…" : "Add line"}</EButton>
        </>
      )}
    >
      <form id={formId} className="space-y-4" onSubmit={submit}>
        {!editing && items ? (
          <div className="space-y-1.5">
            <p className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Saved invoice items</p>
            {items.status === "loading" ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading saved items…</p> : null}
            {items.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{items.message}</p> : null}
            {items.status === "ready" && items.value.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No saved items.</p> : null}
            {items.status === "ready" && items.value.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {items.value.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={inputsFrozen}
                    onClick={() => {
                      props.onNewLine({ description: item.name, quantity: props.newLine.quantity || "1", unitPrice: item.rate.toFixed(2) });
                      setGstNote(savedItemGstNote(item.gst, props.gstEnabled));
                    }}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] disabled:opacity-50"
                  >
                    {item.name} <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{money(item.rate)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {gstNote ? <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">{gstNote}</p> : null}
          </div>
        ) : null}
        <label className="block space-y-1.5">
          <span className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Description</span>
          <input className={SHEET_INPUT} value={value.description} disabled={inputsFrozen} onChange={(event) => setValue({ ...value, description: event.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Quantity</span>
            <input className={cn(SHEET_INPUT, "e-tnum")} inputMode="decimal" value={value.quantity} disabled={inputsFrozen || amountLocked} onChange={(event) => setValue({ ...value, quantity: event.target.value })} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Rate</span>
            <input className={cn(SHEET_INPUT, "e-tnum")} inputMode="decimal" placeholder="0.00" value={value.unitPrice} disabled={inputsFrozen || amountLocked} onChange={(event) => setValue({ ...value, unitPrice: event.target.value })} />
          </label>
        </div>
        {amountLocked ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">This line keeps its amount; only the description can change.</p> : null}
        <div className="flex items-baseline justify-between gap-3 rounded-[10px] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5 text-[0.8125rem]">
          <span className="font-[600]">Line amount</span>
          <span className="text-[hsl(var(--e-muted-foreground))]">{editing && !draftDiffers(editing, editDraft) ? money(editing.lineTotal) : "Worked out when saved"}</span>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The server applies the money rules and GST, then the total updates.</p>
        {!editing && props.failure ? <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">Not added: {props.failure}</p> : null}
      </form>
    </EBottomSheet>
  );
}

/* ── Total bar ───────────────────────────────────────────────────────────── */

export type TotalBarAction = { label: string; onClick: () => void; disabled: boolean; title?: string };

type TotalBarProps = {
  totalLabel: string;
  total: number;
  subtotal: number;
  gst: number;
  /** A one-line note above the total ("1 check to look at", "Unsaved changes"). */
  note: string | null;
  action: TotalBarAction | null;
  hidden?: boolean;
};

export function PhoneTotalBar({ totalLabel, total, subtotal, gst, note, action, hidden = false }: TotalBarProps) {
  return (
    <EPhoneActionBar
      label="Invoice total"
      hidden={hidden}
      secondary={(
        <div className="min-w-0 flex-1" data-total-bar="">
          {note ? <p className="truncate text-[0.6875rem] text-[hsl(var(--e-warning))]">{note}</p> : null}
          <p className="e-tnum truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Subtotal {money(subtotal)} · GST {money(gst)}</p>
          <p className="e-tnum text-[1rem] font-[650]"><span className="sr-only">{totalLabel} </span>{money(total)}</p>
        </div>
      )}
      primary={action ? (
        <EButton type="button" className="!flex-none" disabled={action.disabled} title={action.title} onClick={action.onClick}>{action.label}</EButton>
      ) : <span aria-hidden className="!flex-none" />}
    />
  );
}
