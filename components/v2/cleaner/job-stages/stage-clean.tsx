"use client";

/**
 * Stage 4 — Clean. The admin/carry-forward checklist (jobTasks) plus the
 * assigned form template rendered as a room accordion (sections collapsed by
 * default except the first incomplete one, each header showing "done/total").
 * A sticky mini progress bar summarises tasks + photos, and each section offers
 * a "Report an exception" shortcut that jumps to the exceptions field.
 *
 * All form/checklist STATE + handlers come from the workspace unchanged — this
 * stage only re-homes the presentation and computes section progress to hand
 * FormRenderer (which stays behavior-compatible: the new props default off).
 */
import { tourTarget } from "@/lib/tutorials/targets";
import * as React from "react";
import { UrgentStockWorkspace } from "@/components/inventory/urgent-stock-workspace";
import { ListChecks, ClipboardCheck, Camera, CheckCircle2, AlertTriangle, Images } from "lucide-react";
import { ECard, ECardBody, EAlert, EButton } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { flattenFieldsOneLevel, isTemplateNodeVisible, isFlattenedFieldVisible } from "@/lib/forms/visibility";
import { formNavigation } from "@/lib/forms/navigation";
import type { StockTableStock } from "@/lib/forms/stock-table";

import { isUploadFieldType } from "@/lib/forms/field-types";
import { BulkPhotoAssign, type BulkAssignField } from "@/components/v2/cleaner/bulk-photo-assign";
import { TaskChip } from "@/components/v2/cleaner/job-stages/parts";
import { EarlyCheckoutStatus } from "@/components/v2/cleaner/job-actions";
import { PurchaseAsksCard } from "@/components/v2/cleaner/purchase-asks-card";
import { titleCase, type JobTask, type TaskDraft, type WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";
import { EPill } from "@/components/v2/ui/pill";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EInput } from "@/components/v2/cleaner/fields";
import { COULD_NOT_CHARGE_REASONS } from "@/lib/property-devices/types";

/** A device charge task (2026-11-20): high priority, photo always required, never "not applicable". */
function isDeviceChargeTask(task: JobTask): boolean {
  return task.metadata?.kind === "DEVICE_CHARGE";
}

/**
 * The extra controls on a device charge task: quick reasons when it could not
 * be done, and the battery percent the cleaner saw after charging (optional).
 */
function DeviceChargeExtras({ task, draft, locked, onChange }: { task: JobTask; draft: TaskDraft; locked: boolean; onChange: (patch: Partial<TaskDraft>) => void }) {
  const inputId = `device-battery-${task.id}`;
  if (draft.decision === "NOT_COMPLETED") {
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label="Why it could not be done">
        {COULD_NOT_CHARGE_REASONS.map((reason) => (
          <TaskChip key={reason} active={draft.note.trim() === reason} disabled={locked} tone="warning" onClick={() => onChange({ note: reason })}>
            {reason}
          </TaskChip>
        ))}
      </div>
    );
  }
  if (draft.decision !== "COMPLETED") return null;
  return (
    <label htmlFor={inputId} className="block text-[0.8125rem]">
      Battery shown after charging, if the device shows it (optional)
      <span className="mt-1 flex max-w-[10rem] items-center gap-2">
        <EInput id={inputId} inputMode="numeric" pattern="[0-9]*" maxLength={3} value={draft.observedBatteryPercent ?? ""} disabled={locked} onChange={(event) => onChange({ observedBatteryPercent: event.target.value.replace(/[^0-9]/g, "") })} />
        <span aria-hidden>%</span>
      </span>
    </label>
  );
}

export function StageClean({ api }: { api: WorkspaceApi }) {
  const [urgentStockMounted, setUrgentStockMounted] = React.useState(false);
  const [urgentStockOpen, setUrgentStockOpen] = React.useState(false);
  const { schema, answers, uploads, jobTasks, taskDrafts, locked, property, addressLine, template } = api;

  const uploadCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [fid, media] of Object.entries(uploads)) counts[fid] = media.length;
    return counts;
  }, [uploads]);

  const laundryReady = api.laundryEnabled ? api.laundryOutcome === "READY_FOR_PICKUP" : undefined;
  const stockTable = api.payload?.stockTable as StockTableStock | undefined;
  const navigation = React.useMemo(() => formNavigation(schema, answers, uploadCounts, property ?? {}, laundryReady, api.requiredChecklistTicksBlockSubmit, api.canUseNoPhoto, stockTable), [schema, answers, uploadCounts, property, laundryReady, api.requiredChecklistTicksBlockSubmit, api.canUseNoPhoto, stockTable]);
  const sectionProgress = React.useCallback((sectionId: string) => navigation.rooms.find(room => room.id === sectionId), [navigation]);
  // Flat list of the form's upload fields (form order), for the bulk assign
  // sheet's destination list. Same flatten + visibility rules the renderer uses,
  // so a hidden section never shows up as a destination.
  const bulkFields = React.useMemo<BulkAssignField[]>(() => {
    const out: BulkAssignField[] = [];
    const sections = Array.isArray(schema?.sections) ? schema!.sections : [];
    for (const section of sections) {
      if (!isTemplateNodeVisible(section as any, answers, property ?? {}, laundryReady)) continue;
      const fields = flattenFieldsOneLevel(section.fields).filter((f: any) =>
        isFlattenedFieldVisible(f, answers, property ?? {}, laundryReady)
      );
      for (const f of fields) {
        if (!isUploadFieldType(f?.type)) continue;
        out.push({
          id: String(f.id),
          label: String(f.label ?? f.id),
          sectionTitle: String((section as any).title ?? "Photos"),
          required: f.required === true,
          minPhotos: typeof f.minPhotos === "number" ? f.minPhotos : undefined,
        });
      }
    }
    return out;
  }, [schema, answers, property, laundryReady]);

  function reportException() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("sneek:focus-field", { detail: { match: "exception" } }));
    }
  }

  return (
    <div className="space-y-5">
      {!locked && property?.inventoryEnabled && api.job?.propertyId ? <section className="rounded-lg border border-[hsl(var(--e-border))] p-3">
        <EButton variant="outline" onClick={() => { setUrgentStockMounted(true); setUrgentStockOpen(value => !value); }} aria-expanded={urgentStockOpen}>Request urgent stock</EButton>
        {urgentStockMounted ? <div hidden={!urgentStockOpen}><UrgentStockWorkspace key={api.job.propertyId} isAdmin={false} panel lockProperty initialPropertyId={api.job.propertyId} jobId={api.jobId} /></div> : null}
      </section> : null}
      {/* Wave F: the office's "can you buy …" asks for this job / property. */}
      {!locked ? <PurchaseAsksCard jobId={api.jobId} /> : null}
      {/* Admin-raised timing request (early check-in / late checkout) awaiting
          this cleaner's approval — self-hides when there is none. */}
      <EarlyCheckoutStatus jobId={api.jobId} />

      {/* Admin / carry-forward checklist */}
      {jobTasks.length > 0 ? (
        <ECard {...tourTarget("cleaner.job.checklistItem")}>
          <ECardBody className="space-y-4 pt-6">
            <p className="e-eyebrow flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Checklist ({jobTasks.length})
            </p>
            {jobTasks.map((t) => {
              const d = taskDrafts[t.id] ?? { decision: "OPEN", note: "", proof: [] };
              const deviceCharge = isDeviceChargeTask(t);
              return (
                <div key={t.id} className={deviceCharge ? `rounded-[var(--e-radius)] ${toneNoticeClass("attention")} p-3` : "rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3"}>
                  <div className="min-w-0">
                    {deviceCharge ? <EPill tone="warn" className="mb-1">High priority</EPill> : null}
                    <p className="text-[0.875rem] font-[550]">{t.title}</p>
                    {t.description ? (
                      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{t.description}</p>
                    ) : null}
                    <p className="mt-1 text-[0.625rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                      {titleCase(t.source)}
                      {t.requiresPhoto ? " · photo required" : ""}
                      {t.requiresNote ? " · note required" : ""}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <TaskChip active={d.decision === "COMPLETED"} disabled={locked} onClick={() => api.setTask(t.id, { decision: "COMPLETED" })}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Done
                    </TaskChip>
                    <TaskChip
                      active={d.decision === "NOT_COMPLETED"}
                      disabled={locked}
                      tone="warning"
                      onClick={() => api.setTask(t.id, { decision: "NOT_COMPLETED" })}
                    >
                      {deviceCharge ? "Could not do" : "Not done"}
                    </TaskChip>
                    {t.metadata?.allowNotApplicable === true ? (
                      <TaskChip active={d.decision === "NOT_APPLICABLE"} disabled={locked}
                        onClick={() => api.setTask(t.id, { decision: "NOT_APPLICABLE" })}>Not applicable</TaskChip>
                    ) : null}
                  </div>
                  {d.decision !== "OPEN" ? (
                    <div className="mt-3 space-y-2">
                      <ETextarea
                        placeholder={
                          d.decision === "NOT_APPLICABLE" ? "Why it does not apply (reason and photo required; no carry-forward)" : d.decision === "NOT_COMPLETED"
                            ? deviceCharge ? "Why it could not be done (required). The office is told and it moves to the next clean." : "Reason it wasn't done (required)"
                            : t.requiresNote
                              ? "Add a note (required)"
                              : "Add a note (optional)"
                        }
                        value={d.note}
                        disabled={locked}
                        onChange={(e) => api.setTask(t.id, { note: e.target.value })}
                      />
                      {deviceCharge ? <DeviceChargeExtras task={t} draft={d} locked={locked} onChange={(patch) => api.setTask(t.id, patch)} /> : null}
                      {(t.requiresPhoto && !(deviceCharge && d.decision === "NOT_COMPLETED")) || d.decision === "COMPLETED" || d.decision === "NOT_APPLICABLE" ? (
                        <div>
                          <p className="mb-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            <Camera className="h-3.5 w-3.5" /> {deviceCharge ? "Photo of the device on charge, or charged and back in place (required)" : <>Proof photo{t.requiresPhoto || d.decision === "NOT_APPLICABLE" ? " (required)" : ""}</>}
                          </p>
                          {t.requiresPhoto && d.proof.length === 0 && !t.metadata?.strictPhoto ? <label className="block text-sm">If no photo is available, explain why (work completion remains unverified)<textarea value={d.missingPhotoReason ?? ""} disabled={locked} maxLength={2000} onChange={e => api.setTask(t.id, { missingPhotoReason: e.target.value })} className="w-full rounded border p-2" /></label> : null}
                          <MediaCapture
                            evidenceDestination={{ type: "jobTask", taskId: t.id }}
                            value={d.proof}
                            onChange={(m) => api.setTask(t.id, { proof: m })}
                            mode="photo"
                            folder="evidence"
                            disabled={locked}
                            stamp={{
                              address: addressLine || undefined,
                              reference: (property?.name as string) || undefined,
                              contextLabel: t.title || undefined,
                              tag: "after",
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </ECardBody>
        </ECard>
      ) : null}

      {/* The assigned form template — rendered as a room accordion */}
      {schema ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="e-eyebrow flex items-center gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5" /> {template?.name || "Job form"}
            </p>
            <div className="flex items-center gap-3">
              {!locked && bulkFields.length > 0 ? (
                <EButton variant="outline" size="sm" onClick={api.openBulkAssign}>
                  <Images className="h-4 w-4" /> Bulk upload photos
                  {api.bulkPool.length > 0 ? ` (${api.bulkPool.length})` : ""}
                </EButton>
              ) : null}
              <button
              type="button"
              onClick={reportException}
              className="inline-flex items-center gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-warning))] underline-offset-2 hover:underline"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Report an exception
              </button>
            </div>
          </div>
          <FormRenderer
            schema={schema}
            laundryReady={laundryReady}
            answers={answers}
            uploads={uploads}
            property={property}
            onAnswer={api.onAnswer}
            onUpload={api.onUpload}
            disabled={locked}
            collapsibleSections
            sectionProgress={sectionProgress}
            requiredChecklistTicksBlockSubmit={api.requiredChecklistTicksBlockSubmit}
            canUseNoPhoto={api.canUseNoPhoto}
            enforceExtendedRules={api.enforceExtendedRules}
            effectsJobId={api.jobId}
            mode={api.formMode}
            stockUpdateMode={api.payload?.stockUpdateMode}
            propertyId={api.payload?.job?.propertyId}
            stockTable={stockTable}
            onRetryStockTable={api.load}
          />
        </div>
      ) : (
        <EAlert tone="warning" title="No form template">
          No active form template is configured for this job type — you can still clock in/out and complete the checklist.
        </EAlert>
      )}

      {/* Upload the whole batch once, then file the shots into sections. */}
      <BulkPhotoAssign
        open={api.bulkAssignOpen && !locked}
        onClose={api.closeBulkAssign}
        pool={api.bulkPool}
        setPool={api.setBulkPool}
        uploads={uploads}
        setUploads={api.setUploads}
        fields={bulkFields}
        prepareAutoAssign={api.prepareBulkAutoAssign}
        stamp={{
          address: addressLine || undefined,
          reference: (property?.name as string) || undefined,
          tag: "after",
        }}
      />
    </div>
  );
}
