"use client";

/**
 * The template builder on a phone (board "M-InsightsForms", owner decision
 * 2026-11-13: fully editable on a phone). Rendered only below 640px (the
 * builder gates on useIsPhone); from 640px up the three panes, and the pane
 * tabs below `lg`, are unchanged.
 *
 * Stacked screens instead of panes:
 *   Outline   sections with Move up / Move down (the existing section
 *             reorder, no dragging needed) and "+ Add section"
 *   Questions the section's questions: the very same QuestionsPane (select
 *             several, the bulk bar, section settings, each row's menu) and
 *             "+ Add a question", a sheet with every question type, Heading,
 *             Divider and saved blocks
 *   Editor    the very same settings editor as the desktop right pane (one
 *             question, or several together), with Move up / Move down
 *   Preview   the cleaner preview with the checks result
 *
 * Presentation and navigation only: every edit goes through the callbacks
 * the desktop panes use, so the draft, autosave, undo and versions behave
 * exactly as on desktop.
 */
import * as React from "react";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { PhoneBackBar } from "@/components/v2/admin/phone-back-bar";
import { FIELD_CATEGORY_LABELS, FIELD_CATEGORY_ORDER, FIELD_TYPES } from "@/lib/forms/field-types";
import { describePropertyCondition } from "@/lib/forms/property-conditions";
import type { BadgeContext } from "@/lib/forms/question-badges";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import type { TemplateCheckResult } from "@/lib/forms/template-checks";
import { isPropertyFieldCondition, type FormFieldType, type FormSchema } from "@/lib/forms/types";
import { DIVIDER_LABEL } from "./blocks";
import { CleanerPreview, checksPill } from "./cleaner-preview";
import type { ConditionSourceField } from "./condition-editor";
import { PALETTE_LABEL, sectionRepeatLabel } from "./outline-pane";
import type { RowAction } from "./question-row";
import { QuestionsPane, type BulkAction } from "./questions-pane";
import type { BuilderEditing } from "./use-builder-editing";

export type BuilderPhoneScreen = "outline" | "questions" | "editor" | "preview";

export type BuilderPhoneProps = {
  screen: BuilderPhoneScreen;
  onScreen: (screen: BuilderPhoneScreen) => void;
  schema: FormSchema;
  editing: BuilderEditing;
  checks: TemplateCheckResult;
  badgeContext: BadgeContext;
  conditionFields: ConditionSourceField[];
  busy: boolean;
  /** The desktop row actions (edit, up, down, move, duplicate, copy, block, delete). */
  onRowAction: (fieldId: string, action: RowAction) => void;
  onBulk: (action: BulkAction) => void;
  /** The existing section reorder (lib/forms/builder-ops moveSectionBy), for any section. */
  onMoveSection: (sectionId: string, direction: -1 | 1) => void;
  onAddSection: () => void;
  onAddQuestion: (type: FormFieldType) => void;
  onAddBlock: (kind: "heading" | "divider") => void;
  onInsertBlock: () => void;
  onSectionRemove: () => void;
  onShowChecks: () => void;
  /** The desktop settings editor for the current selection (one question or several). */
  editor: React.ReactNode;
};

function questionLabel(label: string): string {
  return label === DIVIDER_LABEL ? "Divider" : stripHtmlToText(label) || "Untitled question";
}

/** "Outline · Preview · Checks" above the outline and the preview, as drawn. */
function ViewSwitch({ screen, checks, onScreen, onShowChecks }: { screen: BuilderPhoneScreen; checks: TemplateCheckResult; onScreen: (screen: BuilderPhoneScreen) => void; onShowChecks: () => void }) {
  const pill = checksPill(checks);
  return (
    <div role="group" aria-label="Builder view" className="flex gap-1.5">
      <button type="button" aria-pressed={screen !== "preview"} onClick={() => onScreen("outline")} className={cn(E_CHIP_CLASS, "flex-1 justify-center", screen !== "preview" && E_CHIP_ON_CLASS)}>
        Outline
      </button>
      <button type="button" aria-pressed={screen === "preview"} onClick={() => onScreen("preview")} className={cn(E_CHIP_CLASS, "flex-1 justify-center", screen === "preview" && E_CHIP_ON_CLASS)}>
        Preview
      </button>
      <button type="button" onClick={onShowChecks} aria-label={`Checks: ${pill.label}. Show the list.`} className={cn(E_CHIP_CLASS, "flex-1 justify-center")}>
        Checks <EPill tone={pill.tone}>{pill.tone === "ok" ? "✓" : checks.errors > 0 ? checks.errors : checks.warnings}</EPill>
      </button>
    </div>
  );
}

function OutlineScreen({ schema, editing, busy, onOpenSection, onMoveSection, onAddSection }: { schema: FormSchema; editing: BuilderEditing; busy: boolean; onOpenSection: (id: string) => void; onMoveSection: BuilderPhoneProps["onMoveSection"]; onAddSection: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="e-eyebrow">Sections</h2>
        <EButton variant="outline" size="sm" onClick={onAddSection} disabled={busy}>+ Add section</EButton>
      </div>
      {schema.sections.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No sections yet. Add one to start.</p> : null}
      <ol className="flex flex-col gap-2">
        {schema.sections.map((section, index) => {
          const title = section.title || "Untitled section";
          const repeat = sectionRepeatLabel(section);
          const propertyRule = isPropertyFieldCondition(section.conditional) ? describePropertyCondition(section.conditional) : null;
          const active = section.id === editing.activeSection?.id;
          return (
            <li key={section.id} className={cn("flex items-center gap-1.5 rounded-[var(--e-radius-lg)] border bg-[hsl(var(--e-surface))] py-1 pl-3 pr-1.5", active ? "border-[hsl(var(--e-primary)/0.5)]" : "border-[hsl(var(--e-border))]")}>
              <button type="button" onClick={() => onOpenSection(section.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[0.875rem] font-[600]">{title}</span>
                  <span className="flex flex-wrap items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {`${section.fields.length} question${section.fields.length === 1 ? "" : "s"}`}
                    {repeat ? <EPill>{repeat}</EPill> : null}
                    {propertyRule ? <EPill tone="warn">if property has</EPill> : null}
                  </span>
                </span>
                <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
              </button>
              <EButton variant="ghost" size="icon" aria-label={`Move ${title} up`} disabled={busy || index === 0} onClick={() => onMoveSection(section.id, -1)}>
                <ArrowUp aria-hidden className="h-4 w-4" />
              </EButton>
              <EButton variant="ghost" size="icon" aria-label={`Move ${title} down`} disabled={busy || index === schema.sections.length - 1} onClick={() => onMoveSection(section.id, 1)}>
                <ArrowDown aria-hidden className="h-4 w-4" />
              </EButton>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** "Add to Kitchen": every question type, Heading, Divider and "Insert saved block…". */
function AddQuestionSheet({ open, onOpenChange, sectionTitle, busy, onAddQuestion, onAddBlock, onInsertBlock }: { open: boolean; onOpenChange: (open: boolean) => void; sectionTitle: string; busy: boolean; onAddQuestion: (type: FormFieldType) => void; onAddBlock: (kind: "heading" | "divider") => void; onInsertBlock: () => void }) {
  const chip = "inline-flex min-h-11 items-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3.5 text-[0.8125rem] font-[500] text-[hsl(var(--e-text-secondary))] disabled:opacity-50";
  const pick = (run: () => void) => {
    onOpenChange(false);
    run();
  };
  return (
    <EBottomSheet open={open} onOpenChange={onOpenChange} title={`Add to ${sectionTitle}`} description="Saved blocks insert a checklist block you saved before.">
      <div className="flex flex-col gap-3">
        {FIELD_CATEGORY_ORDER.map((category) => (
          <div key={category} role="group" aria-label={FIELD_CATEGORY_LABELS[category]} className="flex flex-wrap gap-2">
            {Object.values(FIELD_TYPES)
              .filter((def) => def.category === category)
              .map((def) => (
                <button key={def.type} type="button" disabled={busy} className={chip} onClick={() => pick(() => onAddQuestion(def.type))}>
                  {PALETTE_LABEL[def.type] ?? def.label}
                </button>
              ))}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={cn(chip, "border-dashed")} onClick={() => pick(() => onAddBlock("heading"))}>Heading</button>
          <button type="button" disabled={busy} className={cn(chip, "border-dashed")} onClick={() => pick(() => onAddBlock("divider"))}>Divider</button>
        </div>
        <EButton variant="outline" disabled={busy} onClick={() => pick(onInsertBlock)}>Insert saved block…</EButton>
      </div>
    </EBottomSheet>
  );
}

/** The question's other row actions (Move up / Move down are buttons on the screen). */
function rowMenuItems(onAction: (action: RowAction) => void): ERowMenuItem[] {
  return [
    { key: "move", label: "Move to section…", onSelect: () => onAction("move") },
    { key: "duplicate", label: "Duplicate", onSelect: () => onAction("duplicate"), separated: true },
    { key: "copy", label: "Copy to other forms…", onSelect: () => onAction("copy") },
    { key: "block", label: "Save as block…", onSelect: () => onAction("block") },
    { key: "delete", label: "Delete", danger: true, separated: true, onSelect: () => onAction("delete") },
  ];
}

export function BuilderPhone(props: BuilderPhoneProps) {
  const { screen, onScreen, schema, editing, checks, busy } = props;
  const [adding, setAdding] = React.useState(false);
  const screenRef = React.useRef<HTMLElement>(null);
  const firstRender = React.useRef(true);

  // A new screen takes focus (and the reader's place) at its top.
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    screenRef.current?.focus();
  }, [screen]);

  const section = editing.activeSection;
  const sectionTitle = section?.title || "Untitled section";
  const focused = editing.selectedIds.length > 1 ? null : editing.focused;
  const fieldIndex = focused ? focused.section.fields.findIndex((field) => field.id === focused.field.id) : -1;
  const fieldCount = focused?.section.fields.length ?? 0;

  let body: React.ReactNode;
  if (screen === "questions") {
    body = (
      <>
        <PhoneBackBar
          title={section ? `Section ${editing.sectionIndex + 1} of ${schema.sections.length}` : "No section"}
          backLabel="Back to outline"
          onBack={() => onScreen("outline")}
        />
        {editing.selectedIds.length > 1 ? (
          <EButton variant="outline" onClick={() => onScreen("editor")}>{`Edit ${editing.selectedIds.length} questions together`}</EButton>
        ) : null}
        <QuestionsPane
          section={section}
          sectionIndex={editing.sectionIndex}
          sectionCount={schema.sections.length}
          badgeContext={props.badgeContext}
          conditionFields={props.conditionFields}
          selectedIds={editing.selectedIds}
          focusedId={editing.focusedId}
          disabled={busy}
          onSelectAll={editing.selectAll}
          onToggle={editing.toggle}
          onFocus={(fieldId) => {
            editing.focus(fieldId);
            onScreen("editor");
          }}
          onClearSelection={editing.clearSelection}
          onRowAction={props.onRowAction}
          onBulk={props.onBulk}
          onSectionChange={editing.changeSection}
          onSectionMove={editing.moveSection}
          onSectionDuplicate={editing.duplicateSection}
          onSectionRemove={props.onSectionRemove}
        />
        {section ? (
          <EButton variant="outline" disabled={busy} onClick={() => setAdding(true)}>{`+ Add a question to ${sectionTitle}`}</EButton>
        ) : null}
        <AddQuestionSheet
          open={adding}
          onOpenChange={setAdding}
          sectionTitle={sectionTitle}
          busy={busy}
          onAddQuestion={props.onAddQuestion}
          onAddBlock={props.onAddBlock}
          onInsertBlock={props.onInsertBlock}
        />
      </>
    );
  } else if (screen === "editor") {
    const label = focused ? questionLabel(focused.field.label) : editing.selectedIds.length > 1 ? `Editing ${editing.selectedIds.length} questions` : "No question selected";
    body = (
      <>
        <PhoneBackBar
          title={label}
          subtitle={focused ? `${focused.section.title || "Untitled section"} · question ${fieldIndex + 1} of ${fieldCount}` : undefined}
          backLabel="Back to questions"
          onBack={() => onScreen("questions")}
          actions={
            focused ? (
              <ERowMenu
                label={`More actions for "${label}"`}
                triggerVariant="outline"
                items={rowMenuItems((action) => props.onRowAction(focused.field.id, action))}
              />
            ) : null
          }
        />
        {props.editor}
        {focused ? (
          <div className="flex gap-2">
            <EButton variant="outline" className="flex-1" disabled={busy || fieldIndex <= 0} onClick={() => props.onRowAction(focused.field.id, "up")}>
              <ArrowUp aria-hidden className="h-4 w-4" /> Move up
            </EButton>
            <EButton variant="outline" className="flex-1" disabled={busy || fieldIndex === fieldCount - 1} onClick={() => props.onRowAction(focused.field.id, "down")}>
              <ArrowDown aria-hidden className="h-4 w-4" /> Move down
            </EButton>
          </div>
        ) : null}
      </>
    );
  } else if (screen === "preview") {
    body = (
      <>
        <ViewSwitch screen={screen} checks={checks} onScreen={onScreen} onShowChecks={props.onShowChecks} />
        {schema.sections.length > 1 ? (
          <label className="flex flex-col gap-1 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
            Section to preview
            <select
              value={section?.id ?? ""}
              onChange={(event) => editing.selectSection(event.target.value)}
              className="min-h-11 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[1rem] font-normal text-[hsl(var(--e-foreground))]"
            >
              {schema.sections.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.title || "Untitled section"}</option>
              ))}
            </select>
          </label>
        ) : null}
        <CleanerPreview section={section} theme={schema.theme} checks={checks} onShowChecks={props.onShowChecks} />
      </>
    );
  } else {
    body = (
      <>
        <ViewSwitch screen={screen} checks={checks} onScreen={onScreen} onShowChecks={props.onShowChecks} />
        <OutlineScreen
          schema={schema}
          editing={editing}
          busy={busy}
          onOpenSection={(id) => {
            editing.selectSection(id);
            onScreen("questions");
          }}
          onMoveSection={props.onMoveSection}
          onAddSection={props.onAddSection}
        />
      </>
    );
  }

  return (
    <section ref={screenRef} tabIndex={-1} aria-label={SCREEN_LABEL[screen]} data-builder-phone-screen={screen} className="flex min-w-0 flex-col gap-3 focus:outline-none">
      {body}
    </section>
  );
}

const SCREEN_LABEL: Record<BuilderPhoneScreen, string> = {
  outline: "Outline",
  questions: "Section questions",
  editor: "Question settings",
  preview: "Cleaner preview",
};
