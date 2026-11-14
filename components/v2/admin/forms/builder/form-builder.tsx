"use client";

/**
 * Form template builder (/v2/admin/forms/[id]/edit), as drawn in the
 * approved "Template builder" design: header; Outline (sections and "Add a
 * question") · Questions of the selected section · Settings for the selection
 * and "Cleaner sees". At phone width the three panes become steps.
 *
 * Everything edits the template's DRAFT (autosaved with the stale-write
 * token; lib/forms/template-drafts.ts). Publishing is the only step that
 * changes what jobs resolve to. State lives in:
 *   use-builder-document — the document + undo/redo
 *   use-draft-autosave   — saving the draft, conflicts, leave warning
 *   use-builder-editing  — selection and schema operations
 *   use-builder-lifecycle — publish, archive, duplicate, discard, conflict exits
 */
import * as React from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { EButton } from "@/components/v2/ui/primitives";
import { checkTemplateSchema } from "@/lib/forms/template-checks";
import { buildBadgeContext } from "@/lib/forms/question-badges";
import type { FormSchema } from "@/lib/forms/types";
import type { BuilderUsage } from "@/lib/forms/builder-context";
import { cn } from "@/lib/utils";
import { BuilderHeader, BuilderPhoneActionBar, publishTarget, type BuilderStatus } from "./builder-header";
import { BuilderOverlays, type Overlay } from "./builder-overlays";
import { undoToast } from "@/components/v2/ui/undo-toast";
import { toast } from "@/hooks/use-toast";
import { CleanerPreview } from "./cleaner-preview";
import { MultiEditPanel } from "./multi-edit-panel";
import { OutlinePane } from "./outline-pane";
import { PropertiesPanel } from "./properties-panel";
import { QuestionsPane, type BulkAction } from "./questions-pane";
import type { RowAction } from "./question-row";
import { useBuilderDocument } from "./use-builder-document";
import { useBuilderEditing } from "./use-builder-editing";
import { useBuilderLifecycle } from "./use-builder-lifecycle";
import { draftFailureReason, useDraftAutosave } from "./use-draft-autosave";
import { useInlineRename } from "./use-inline-rename";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { moveSectionBy } from "@/lib/forms/builder-ops";
import { BuilderPhone, type BuilderPhoneScreen } from "./builder-phone";

export interface EstateFormBuilderProps {
  templateId: string;
  initialName: string;
  initialKind: string;
  initialServiceType: string;
  initialVersion: number;
  initialSchema: FormSchema;
  initialIsActive: boolean;
  initialArchived: boolean;
  /** Edit token this render was built from (draft's updatedAt, else the template's). */
  initialUpdatedAt?: string;
  /** The template row's updatedAt (stale-write guard for renaming in place). */
  initialTemplateToken?: string;
  /** The template has unpublished changes saved as a draft version. */
  initialHasDraft?: boolean;
  initialDraftSavedAt?: string | null;
  /** Where the live version is used; null = could not be read. */
  usage?: BuilderUsage | null;
}

type Pane = "outline" | "questions" | "settings";
const PANES: Array<{ key: Pane; label: string }> = [
  { key: "outline", label: "Outline" },
  { key: "questions", label: "Questions" },
  { key: "settings", label: "Settings / Preview" },
];

const BANNER_TONE = {
  danger: toneNoticeClass("problem"),
  warning: toneNoticeClass("attention"),
  success: toneNoticeClass("good"),
} as const;

/**
 * Frame of the one-question settings editor. From 640px up it is a bounded
 * flex column, so the properties panel's body (flex-1, min-h-0) scrolls to
 * its last field inside the right-hand pane; without the flex column the
 * panel's height never resolved and everything below the frame's max-height
 * was clipped. On a phone it is in normal flow: the whole question screen
 * scrolls with the page.
 */
const EDITOR_FRAME_CLASS =
  "flex max-h-[70vh] flex-col overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] lg:max-h-[calc(100vh-14rem)] " +
  "max-sm:max-h-none max-sm:overflow-visible";

function Banner({ tone, children }: { tone: keyof typeof BANNER_TONE; children: React.ReactNode }) {
  return (
    <div role={tone === "success" ? "status" : "alert"} className={cn("rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", BANNER_TONE[tone])}>
      {children}
    </div>
  );
}

export function EstateFormBuilder(props: EstateFormBuilderProps) {
  const { templateId } = props;
  const document = useBuilderDocument({ name: props.initialName, serviceType: props.initialServiceType, schema: props.initialSchema });
  const [status, setStatus] = React.useState<BuilderStatus>({
    liveVersion: props.initialVersion,
    isActive: props.initialIsActive,
    archived: props.initialArchived,
    hasDraft: Boolean(props.initialHasDraft),
  });
  const autosave = useDraftAutosave({
    templateId,
    doc: document.doc,
    revision: document.revision,
    initialToken: props.initialUpdatedAt,
    initialSavedAt: props.initialDraftSavedAt ? new Date(props.initialDraftSavedAt) : null,
    enabled: !props.initialArchived,
    onSaved: () => setStatus((prev) => (prev.hasDraft ? prev : { ...prev, hasDraft: true })),
  });
  const editing = useBuilderEditing(document);

  // Tier B removals offer Undo for 10 seconds (board "Confirmations and
  // deletes"). Undo steps the document back only while the removal is still
  // its last change; after another edit the header's Undo is the way back.
  const revisionRef = React.useRef(document.revision);
  revisionRef.current = document.revision;
  const undoRef = React.useRef(document.undo);
  undoRef.current = document.undo;
  const removeWithUndo = React.useCallback((title: string, run: () => void) => {
    const expected = revisionRef.current + 1;
    run();
    undoToast({
      title,
      onUndo: () => {
        if (revisionRef.current === expected) undoRef.current();
        else toast({ title: "Something changed since", description: "Use Undo in the header to step back." });
      },
    });
  }, []);
  const lifecycle = useBuilderLifecycle({ templateId, document, autosave, status, setStatus });
  const rename = useInlineRename({ templateId, document, autosave, initialTemplateToken: props.initialTemplateToken, hasDraft: status.hasDraft });
  const [overlay, setOverlay] = React.useState<Overlay>({ kind: "none" });
  const [pane, setPane] = React.useState<Pane>("questions");
  // Phones (below 640px): stacked screens instead of panes (./builder-phone).
  const phone = useIsPhone();
  const [phoneScreen, setPhoneScreen] = React.useState<BuilderPhoneScreen>("outline");
  const close = React.useCallback(() => setOverlay({ kind: "none" }), []);

  const schema = document.doc.schema;
  const checks = React.useMemo(() => checkTemplateSchema(schema), [schema]);
  const badgeContext = React.useMemo(() => buildBadgeContext(schema, (props.usage?.neverAnswered ?? []).map((q) => q.id)), [schema, props.usage]);
  const conditionFields = React.useMemo(
    () => schema.sections.flatMap((section) => section.fields.flatMap((field) => [field, ...(field.children ?? [])])).map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options })),
    [schema],
  );
  const unsaved = autosave.state.status !== "saved";
  const shownStatus: BuilderStatus = { ...status, hasDraft: status.hasDraft || unsaved };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    if (event.over) editing.drop(event.active.id, event.over.id);
  };
  const fieldsFor = (ids: string[]) => schema.sections.flatMap((section) => section.fields.filter((field) => ids.includes(field.id)));
  const leave = () => !unsaved || window.confirm("Some edits are not saved yet. Leave anyway?");

  const rowAction = (fieldId: string, action: RowAction) => {
    if (action === "edit") return (editing.focus(fieldId), setPane("settings"), setPhoneScreen("editor"));
    if (action === "up" || action === "down") return editing.moveBy(fieldId, action === "up" ? -1 : 1);
    if (action === "duplicate") return editing.duplicate([fieldId]);
    if (action === "move") return setOverlay({ kind: "move", ids: [fieldId] });
    if (action === "copy") return setOverlay({ kind: "copy", ids: [fieldId] });
    if (action === "block") return setOverlay({ kind: "save-block", ids: [fieldId] });
    setOverlay({ kind: "delete", ids: [fieldId] });
  };
  const bulk = (action: BulkAction) => {
    const ids = editing.selectedIds;
    if (action === "duplicate") return editing.duplicate(ids);
    if (action === "move") return setOverlay({ kind: "move", ids });
    if (action === "copy") return setOverlay({ kind: "copy", ids });
    if (action === "block") return setOverlay({ kind: "save-block", ids });
    setOverlay({ kind: "delete", ids });
  };
  const target = publishTarget(shownStatus);
  const bulkActive = editing.selectedIds.length > 0;
  const openPublish = () => {
    lifecycle.setError(null);
    setOverlay({ kind: "publish" });
  };
  /** The existing section reorder for any section (the phone outline's Move up / Move down). */
  const moveSectionAt = (sectionId: string, direction: -1 | 1) => document.editSchema((current) => moveSectionBy(current, sectionId, direction));
  const focusedSectionRepeat = editing.focused?.section.repeatBy;
  const resetSnapshot = React.useRef<{ key: string; fields: ReturnType<typeof fieldsFor> } | null>(null);
  const selectionKey = editing.selectedIds.join(",");
  if (editing.selectedIds.length > 1 && resetSnapshot.current?.key !== selectionKey) {
    resetSnapshot.current = { key: selectionKey, fields: fieldsFor(editing.selectedIds) };
  }

  // The settings editor for the selection: the desktop right pane, and the phone's question screen.
  const editor = (
    <>
      {editing.selectedIds.length > 1 ? (
        <MultiEditPanel
          fields={editing.selectedFields}
          conditionFields={conditionFields}
          onApply={editing.applyPatch}
          onReset={() => {
            const snapshot = resetSnapshot.current?.fields ?? [];
            document.editSchema((current) => ({ ...current, sections: current.sections.map((section) => ({ ...section, fields: section.fields.map((field) => snapshot.find((s) => s.id === field.id) ?? field) })) }));
          }}
        />
      ) : editing.focused ? (
        <div className={EDITOR_FRAME_CLASS} data-builder-editor-frame="">
          <PropertiesPanel
            key={editing.focused.field.id}
            field={editing.focused.field}
            onUpdate={(next) => editing.updateField(editing.focused!.field.id, next)}
            onRemove={() => setOverlay({ kind: "delete", ids: [editing.focused!.field.id] })}
            onDuplicate={() => editing.duplicate([editing.focused!.field.id])}
            availableFields={conditionFields.filter((f) => f.id !== editing.focused!.field.id)}
            repeatNote={focusedSectionRepeat ? `Asked once per ${focusedSectionRepeat === "bathrooms" ? "bathroom" : "bedroom"}, with its section.` : undefined}
          />
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-[hsl(var(--e-border-strong))] p-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
          Select a question to edit it, or tick several to edit them together.
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-3.5" onKeyDown={document.onKeyDown}>
      <BuilderHeader
        name={document.doc.name}
        status={shownStatus}
        usage={props.usage?.usage}
        saveState={autosave.state}
        canUndo={document.canUndo}
        canRedo={document.canRedo}
        busy={lifecycle.busy}
        onUndo={document.undo}
        onRedo={document.redo}
        onVersions={() => setOverlay({ kind: "versions" })}
        onTest={() => setOverlay({ kind: "test" })}
        onPublish={openPublish}
        onLeave={leave}
        onRename={rename}
        menuItems={[
          { key: "settings", label: "Form settings (name, service type, theme)", onSelect: () => setOverlay({ kind: "settings" }) },
          { key: "checks", label: `Checks (${checks.errors} problems, ${checks.warnings} warnings)`, onSelect: () => setOverlay({ kind: "checks" }) },
          { key: "duplicate", label: "Duplicate form", onSelect: () => void lifecycle.duplicate(), separated: true },
          status.archived
            ? { key: "unarchive", label: "Unarchive", onSelect: () => void lifecycle.setArchived("unarchive") }
            : { key: "archive", label: "Archive", onSelect: () => void lifecycle.setArchived("archive"), disabled: !status.isActive, hint: "Only a live form can be archived." },
          { key: "discard", label: "Discard unpublished changes", danger: true, disabled: !status.hasDraft, onSelect: () => setOverlay({ kind: "discard" }) },
        ]}
      />
      {autosave.state.status === "conflict" ? (
        <Banner tone="warning">
          <p className="font-[600]">This form changed in another tab or by another admin since you opened it.</p>
          <p className="mt-0.5">Your edits are not saved and autosave has stopped, so nothing of theirs is overwritten. Choose:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" onClick={() => window.confirm("Reload and lose the edits made in this tab?") && window.location.reload()}>Reload theirs</EButton>
            <EButton size="sm" onClick={() => void lifecycle.keepMineAsCopy()} disabled={lifecycle.busy}>Keep mine as a copy</EButton>
          </div>
        </Banner>
      ) : null}
      {autosave.state.status === "failed" ? (
        <Banner tone="danger">
          <span className="font-[600]">The draft was not saved.</span> {draftFailureReason(autosave.state.error)} Your edits are kept here.{" "}
          <EButton size="sm" variant="outline" className="ml-1" onClick={() => void autosave.flush()}>Retry</EButton>
        </Banner>
      ) : null}
      {status.archived ? <Banner tone="warning">This form is archived: autosave is off. Unarchive it (More menu) to edit and publish again.</Banner> : null}
      {lifecycle.error && overlay.kind !== "publish" ? <Banner tone="danger">{lifecycle.error}</Banner> : null}
      {lifecycle.notice ?? editing.notice ? <Banner tone="success">{lifecycle.notice ?? editing.notice}</Banner> : null}

      {phone ? null : (
      <nav aria-label="Builder panes" className="flex gap-1 border-b border-[hsl(var(--e-border))] max-sm:hidden lg:hidden">
        {PANES.map((entry) => (
          <button key={entry.key} type="button" onClick={() => setPane(entry.key)} aria-current={pane === entry.key ? "page" : undefined} className={cn("min-h-11 border-b-2 px-3 text-[0.8125rem] font-[500]", pane === entry.key ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]")}>
            {entry.label}
          </button>
        ))}
      </nav>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {phone ? (
          <BuilderPhone
            screen={phoneScreen}
            onScreen={setPhoneScreen}
            schema={schema}
            editing={editing}
            checks={checks}
            badgeContext={badgeContext}
            conditionFields={conditionFields}
            busy={lifecycle.busy}
            onRowAction={rowAction}
            onBulk={bulk}
            onMoveSection={moveSectionAt}
            onAddSection={editing.addSection}
            onAddQuestion={(type) => { editing.addQuestion(type); setPhoneScreen("editor"); }}
            onAddBlock={editing.addBlock}
            onInsertBlock={() => setOverlay({ kind: "insert-block" })}
            onSectionRemove={() => editing.activeSection && setOverlay({ kind: "delete-section", sectionId: editing.activeSection.id })}
            onShowChecks={() => setOverlay({ kind: "checks" })}
            editor={editor}
          />
        ) : (
        <div className="flex min-w-0 flex-col gap-3.5 max-sm:hidden lg:flex-row lg:items-start">
          <div className={cn("lg:block lg:w-[220px] lg:flex-none", pane === "outline" ? "block" : "hidden")}>
            <OutlinePane
              schema={schema}
              activeSectionId={editing.activeSection?.id ?? null}
              onSelectSection={(id) => { editing.selectSection(id); setPane("questions"); }}
              onAddSection={editing.addSection}
              onAddQuestion={(type) => { editing.addQuestion(type); setPane("settings"); }}
              onAddBlock={editing.addBlock}
              onInsertBlock={() => setOverlay({ kind: "insert-block" })}
              disabled={lifecycle.busy}
            />
          </div>
          <div className={cn("min-w-0 lg:flex lg:flex-1", pane === "questions" ? "flex" : "hidden")}>
            <QuestionsPane
              section={editing.activeSection}
              sectionIndex={editing.sectionIndex}
              sectionCount={schema.sections.length}
              badgeContext={badgeContext}
              conditionFields={conditionFields}
              selectedIds={editing.selectedIds}
              focusedId={editing.focusedId}
              disabled={lifecycle.busy}
              onSelectAll={editing.selectAll}
              onToggle={editing.toggle}
              onFocus={editing.focus}
              onClearSelection={editing.clearSelection}
              onRowAction={rowAction}
              onBulk={bulk}
              onSectionChange={editing.changeSection}
              onSectionMove={editing.moveSection}
              onSectionDuplicate={editing.duplicateSection}
              onSectionRemove={() => editing.activeSection && setOverlay({ kind: "delete-section", sectionId: editing.activeSection.id })}
            />
          </div>
          <aside aria-label="Settings for selection" className={cn("flex-col gap-3.5 lg:flex lg:w-[330px] lg:flex-none", pane === "settings" ? "flex" : "hidden")}>
            {editor}
            <CleanerPreview section={editing.activeSection} theme={schema.theme} checks={checks} onShowChecks={() => setOverlay({ kind: "checks" })} />
          </aside>
        </div>
        )}
      </DndContext>

      <BuilderOverlays
        overlay={overlay}
        close={close}
        templateId={templateId}
        kind={props.initialKind}
        timezone={props.usage?.timezone ?? "Australia/Sydney"}
        doc={document.doc}
        checks={checks}
        publishVersion={target}
        busy={lifecycle.busy}
        publishError={lifecycle.error}
        hasUnsavedEdits={unsaved}
        activeSectionId={editing.activeSection?.id ?? null}
        activeSectionTitle={editing.activeSection?.title ?? ""}
        fieldsFor={fieldsFor}
        onEdit={document.edit}
        onPublish={(note) => void lifecycle.publish(note).then((ok) => ok && close())}
        onRestored={() => lifecycle.adoptServerDraft()}
        onInsertBlock={editing.insertBlockFields}
        onMove={editing.moveTo}
        onDelete={(ids) => removeWithUndo(ids.length > 1 ? `${ids.length} questions deleted` : "Question deleted", () => editing.remove(ids))}
        onDeleteSection={(sectionId) => removeWithUndo("Section deleted", () => editing.removeSection(sectionId))}
        onDiscard={() => void lifecycle.discardDraft()}
      />
      {phone ? (
        <>
          {/*
            Phones: the end of every screen stays clear of what is docked at
            the bottom. The main area already clears the tab bar; this adds the
            safe area, and stands in for the action bar's own spacer while the
            bulk bar (which has none) owns the bottom.
          */}
          <div aria-hidden data-builder-dock-clearance="" className={cn("sm:hidden", bulkActive ? "h-[calc(env(safe-area-inset-bottom)+4.5rem)]" : "h-[env(safe-area-inset-bottom)]")} />
          <BuilderPhoneActionBar
            status={shownStatus}
            busy={lifecycle.busy}
            bulkActive={bulkActive}
            onTest={() => setOverlay({ kind: "test" })}
            onPublish={openPublish}
          />
        </>
      ) : null}
    </div>
  );
}
