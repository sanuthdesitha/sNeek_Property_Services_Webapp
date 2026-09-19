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
import * as React from "react";
import { ListChecks, ClipboardCheck, Camera, CheckCircle2, AlertTriangle, Images } from "lucide-react";
import { ECard, ECardBody, EAlert, EButton } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { flattenFieldsOneLevel, isTemplateNodeVisible, isFlattenedFieldVisible } from "@/lib/forms/visibility";
import { formNavigation } from "@/lib/forms/navigation";
import { FormNavigation } from "@/components/v2/cleaner/form-navigation";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { BulkPhotoAssign, type BulkAssignField } from "@/components/v2/cleaner/bulk-photo-assign";
import { TaskChip } from "@/components/v2/cleaner/job-stages/parts";
import { EarlyCheckoutStatus } from "@/components/v2/cleaner/job-actions";
import { titleCase, type WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

export function StageClean({ api }: { api: WorkspaceApi }) {
  const { schema, answers, uploads, jobTasks, taskDrafts, locked, property, addressLine, template } = api;

  const uploadCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [fid, media] of Object.entries(uploads)) counts[fid] = media.length;
    return counts;
  }, [uploads]);

  const laundryReady = api.laundryEnabled ? api.laundryOutcome === "READY_FOR_PICKUP" : undefined;
  const navigation = React.useMemo(() => formNavigation(schema, answers, uploadCounts, property ?? {}, laundryReady, api.requiredChecklistTicksBlockSubmit, api.canUseNoPhoto), [schema, answers, uploadCounts, property, laundryReady, api.requiredChecklistTicksBlockSubmit, api.canUseNoPhoto]);
  const sectionProgress = React.useCallback((sectionId: string) => navigation.rooms.find(room => room.id === sectionId), [navigation]);
  const tasksDone = navigation.rooms.reduce((sum, room) => sum + room.dataDone, 0);
  const tasksTotal = navigation.rooms.reduce((sum, room) => sum + room.dataTotal, 0);
  const photosDone = navigation.rooms.reduce((sum, room) => sum + room.mediaDone, 0);
  const photosTotal = navigation.rooms.reduce((sum, room) => sum + room.mediaTotal, 0);
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
      {/* Sticky mini progress bar */}
      {schema ? (
        <div className="sticky top-[7.5rem] z-10 -mx-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.95)] px-3 py-2 backdrop-blur lg:top-4">
          <div className="flex items-center justify-between gap-3 text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">
            <span>
              {tasksDone}/{tasksTotal} tasks · {photosDone}/{photosTotal} photos
            </span>
            <span className="tabular-nums">
              {tasksTotal + photosTotal > 0
                ? Math.round(((tasksDone + photosDone) / (tasksTotal + photosTotal)) * 100)
                : 100}
              %
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-muted))]">
            <div
              className="h-full rounded-full bg-[hsl(var(--e-gold))] transition-[width] duration-300"
              style={{
                width: `${
                  tasksTotal + photosTotal > 0
                    ? Math.round(((tasksDone + photosDone) / (tasksTotal + photosTotal)) * 100)
                    : 100
                }%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {schema ? <FormNavigation navigation={navigation} /> : null}
      {/* Admin-raised timing request (early check-in / late checkout) awaiting
          this cleaner's approval — self-hides when there is none. */}
      <EarlyCheckoutStatus jobId={api.jobId} />

      {/* Admin / carry-forward checklist */}
      {jobTasks.length > 0 ? (
        <ECard>
          <ECardBody className="space-y-4 pt-6">
            <p className="e-eyebrow flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Checklist ({jobTasks.length})
            </p>
            {jobTasks.map((t) => {
              const d = taskDrafts[t.id] ?? { decision: "OPEN", note: "", proof: [] };
              return (
                <div key={t.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <div className="min-w-0">
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
                      Not done
                    </TaskChip>
                  </div>
                  {d.decision !== "OPEN" ? (
                    <div className="mt-3 space-y-2">
                      <ETextarea
                        placeholder={
                          d.decision === "NOT_COMPLETED"
                            ? "Reason it wasn't done (required)"
                            : t.requiresNote
                              ? "Add a note (required)"
                              : "Add a note (optional)"
                        }
                        value={d.note}
                        disabled={locked}
                        onChange={(e) => api.setTask(t.id, { note: e.target.value })}
                      />
                      {t.requiresPhoto || d.decision === "COMPLETED" ? (
                        <div>
                          <p className="mb-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            <Camera className="h-3.5 w-3.5" /> Proof photo{t.requiresPhoto ? " (required)" : ""}
                          </p>
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
            stockUpdateMode={api.payload?.stockUpdateMode}
            propertyId={api.payload?.job?.propertyId}
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
        stamp={{
          address: addressLine || undefined,
          reference: (property?.name as string) || undefined,
          tag: "after",
        }}
      />
    </div>
  );
}
