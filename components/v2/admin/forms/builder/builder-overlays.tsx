"use client";

/**
 * Every dialog and drawer the builder opens, in one place so the shell stays
 * readable: Versions, Test as cleaner, Form settings, Checks, Publish, Copy to
 * other forms, Save as block, Insert saved block, Move to section, and the
 * delete confirmations.
 */
import * as React from "react";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { isStandardSectionId, standardSectionDeleteWarning } from "@/lib/forms/standard-sections";
import type { TemplateCheckResult } from "@/lib/forms/template-checks";
import type { FormField, FormSchema } from "@/lib/forms/types";
import { BuilderDrawer } from "./builder-drawer";
import { CopyToFormsDialog } from "./copy-to-forms-dialog";
import { PublishDialog } from "./publish-dialog";
import { InsertBlockDialog, MoveToSectionDialog, SaveBlockDialog } from "./saved-blocks-dialogs";
import { SettingsDrawer } from "./settings-drawer";
import { TestRunDrawer } from "./test-run-drawer";
import { VersionsDrawer } from "./versions-drawer";
import type { BuilderDoc } from "./use-builder-document";

export type Overlay =
  | { kind: "none" }
  | { kind: "versions" }
  | { kind: "test" }
  | { kind: "settings" }
  | { kind: "checks" }
  | { kind: "publish" }
  | { kind: "copy"; ids: string[] }
  | { kind: "save-block"; ids: string[] }
  | { kind: "insert-block" }
  | { kind: "move"; ids: string[] }
  | { kind: "delete"; ids: string[] }
  | { kind: "delete-section"; sectionId: string }
  | { kind: "discard" };

export function BuilderOverlays({
  overlay,
  close,
  templateId,
  kind,
  timezone,
  doc,
  checks,
  publishVersion,
  busy,
  publishError,
  hasUnsavedEdits,
  activeSectionId,
  activeSectionTitle,
  fieldsFor,
  onEdit,
  onPublish,
  onRestored,
  onInsertBlock,
  onMove,
  onDelete,
  onDeleteSection,
  onDiscard,
}: {
  overlay: Overlay;
  close: () => void;
  templateId: string;
  kind: string;
  timezone: string;
  doc: BuilderDoc;
  checks: TemplateCheckResult;
  publishVersion: number | null;
  busy: boolean;
  publishError: string | null;
  hasUnsavedEdits: boolean;
  activeSectionId: string | null;
  activeSectionTitle: string;
  fieldsFor: (ids: string[]) => FormField[];
  onEdit: (next: (doc: BuilderDoc) => BuilderDoc, coalesceKey?: string) => void;
  onPublish: (note: string) => void;
  onRestored: () => void;
  onInsertBlock: (fields: FormField[]) => void;
  onMove: (ids: string[], sectionId: string) => void;
  onDelete: (ids: string[]) => void;
  onDeleteSection: (sectionId: string) => void;
  onDiscard: () => void;
}) {
  const schema: FormSchema = doc.schema;
  const sectionTitleOf = (ids: string[]) =>
    schema.sections.find((section) => section.fields.some((field) => ids.includes(field.id)))?.title ?? activeSectionTitle;
  return (
    <>
      <VersionsDrawer
        open={overlay.kind === "versions"}
        onClose={close}
        templateId={templateId}
        timezone={timezone}
        canWrite
        hasUnsavedEdits={hasUnsavedEdits}
        onRestored={onRestored}
      />
      <TestRunDrawer open={overlay.kind === "test"} onClose={close} templateId={templateId} schema={schema} />
      <SettingsDrawer open={overlay.kind === "settings"} onClose={close} doc={doc} kind={kind} disabled={busy} onEdit={onEdit} />
      <BuilderDrawer open={overlay.kind === "checks"} onClose={close} eyebrow="Checks" title={checks.issues.length ? `${checks.errors} problems · ${checks.warnings} warnings` : "All checks pass"}>
        {checks.issues.length === 0 ? <p className="text-[0.8125rem]">Nothing to fix.</p> : null}
        <ul className="space-y-1.5">
          {checks.issues.map((issue, index) => (
            <li key={`${issue.rule}-${issue.fieldId ?? issue.sectionId ?? index}`} className="text-[0.8125rem]">
              <span className={issue.severity === "error" ? "font-[600] text-[hsl(var(--e-danger))]" : "font-[600] text-[hsl(var(--e-warning))]"}>
                {issue.severity === "error" ? "Problem" : "Warning"}
              </span>{" "}
              — {issue.message}
            </li>
          ))}
        </ul>
      </BuilderDrawer>
      {publishVersion !== null ? (
        <PublishDialog
          open={overlay.kind === "publish"}
          onClose={close}
          templateId={templateId}
          version={publishVersion}
          checks={checks}
          busy={busy}
          error={publishError}
          onPublish={onPublish}
        />
      ) : null}
      <CopyToFormsDialog
        open={overlay.kind === "copy"}
        onClose={close}
        templateId={templateId}
        fields={overlay.kind === "copy" ? fieldsFor(overlay.ids) : []}
        sectionTitle={overlay.kind === "copy" ? sectionTitleOf(overlay.ids) : ""}
      />
      <SaveBlockDialog open={overlay.kind === "save-block"} onClose={close} fields={overlay.kind === "save-block" ? fieldsFor(overlay.ids) : []} />
      <InsertBlockDialog open={overlay.kind === "insert-block"} onClose={close} sectionTitle={activeSectionTitle} canDelete onInsert={onInsertBlock} />
      <MoveToSectionDialog
        open={overlay.kind === "move"}
        onClose={close}
        sections={schema.sections.map((section) => ({ id: section.id, title: section.title }))}
        currentSectionId={overlay.kind === "move" && overlay.ids.length === 1 ? activeSectionId : null}
        count={overlay.kind === "move" ? overlay.ids.length : 0}
        onMove={(sectionId) => overlay.kind === "move" && onMove(overlay.ids, sectionId)}
      />
      <EConfirmModal
        open={overlay.kind === "delete"}
        onClose={close}
        title={overlay.kind === "delete" && overlay.ids.length > 1 ? `Delete ${overlay.ids.length} questions?` : "Delete this question?"}
        description="It comes out of this draft form. You get Undo for 10 seconds; submissions already made keep their answers."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          if (overlay.kind === "delete") onDelete(overlay.ids);
          close();
        }}
      />
      <EConfirmModal
        open={overlay.kind === "delete-section"}
        onClose={close}
        title="Delete this section?"
        description={
          overlay.kind !== "delete-section"
            ? undefined
            : isStandardSectionId(overlay.sectionId)
              ? standardSectionDeleteWarning(overlay.sectionId)
              : "The section and its questions come out of this draft form. You get Undo for 10 seconds."
        }
        confirmLabel="Delete section"
        danger
        onConfirm={() => {
          if (overlay.kind === "delete-section") onDeleteSection(overlay.sectionId);
          close();
        }}
      />
      <EConfirmModal
        open={overlay.kind === "discard"}
        onClose={close}
        title="Discard the unpublished changes?"
        description="The draft is deleted and the builder shows the live version again. Published versions are not affected."
        confirmLabel="Discard draft"
        danger
        onConfirm={() => {
          onDiscard();
          close();
        }}
      />
    </>
  );
}
