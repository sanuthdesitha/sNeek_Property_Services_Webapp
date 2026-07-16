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
import { ListChecks, ClipboardCheck, Camera, CheckCircle2, AlertTriangle } from "lucide-react";
import { ECard, ECardBody, EAlert } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { flattenFieldsOneLevel, isTemplateNodeVisible, isFlattenedFieldVisible } from "@/lib/forms/visibility";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { TaskChip } from "@/components/v2/cleaner/job-stages/parts";
import { EarlyCheckoutStatus } from "@/components/v2/cleaner/job-actions";
import { titleCase, type WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

/** True when a field counts toward "required data" (non-upload, required). */
function isRequiredDataField(field: any): boolean {
  return field?.required === true && !isUploadFieldType(field?.type);
}
/** True when a field counts toward "required photo" (upload, required or min>0). */
function isRequiredPhotoField(field: any): boolean {
  if (!isUploadFieldType(field?.type)) return false;
  return field?.required === true || (typeof field?.minPhotos === "number" && field.minPhotos > 0);
}

export function StageClean({ api }: { api: WorkspaceApi }) {
  const { schema, answers, uploads, jobTasks, taskDrafts, locked, property, addressLine, template } = api;

  const uploadCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [fid, media] of Object.entries(uploads)) counts[fid] = media.length;
    return counts;
  }, [uploads]);

  // Error set (fieldIds still incomplete) — the single source of truth for
  // "satisfied?", mirroring the submit route + FormRenderer's own validation.
  const errorIds = React.useMemo(() => {
    if (!schema) return new Set<string>();
    const errs = collectFormErrors(
      schema,
      answers,
      uploadCounts,
      property ?? {},
      api.laundryEnabled ? api.laundryOutcome === "READY_FOR_PICKUP" : undefined
    );
    return new Set(errs.map((e) => e.fieldId));
  }, [schema, answers, uploadCounts, property, api.laundryEnabled, api.laundryOutcome]);

  // Per-section required tallies (data + photos), computed the same way
  // FormRenderer flattens/filters sections so the counts line up with the UI.
  const { progressBySection, tasksDone, tasksTotal, photosDone, photosTotal } = React.useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    let tD = 0, tT = 0, pD = 0, pT = 0;
    const sections = Array.isArray(schema?.sections) ? schema!.sections : [];
    for (const section of sections) {
      if (!isTemplateNodeVisible(section as any, answers, property ?? {})) continue;
      const fields = flattenFieldsOneLevel(section.fields).filter((f: any) =>
        isFlattenedFieldVisible(f, answers, property ?? {})
      );
      let done = 0, total = 0;
      for (const f of fields) {
        const req = isRequiredDataField(f);
        const photo = isRequiredPhotoField(f);
        if (!req && !photo) continue;
        total += 1;
        const satisfied = !errorIds.has(String(f.id));
        if (satisfied) done += 1;
        if (photo) {
          pT += 1;
          if (satisfied) pD += 1;
        } else {
          tT += 1;
          if (satisfied) tD += 1;
        }
      }
      map.set(section.id, { done, total });
    }
    return { progressBySection: map, tasksDone: tD, tasksTotal: tT, photosDone: pD, photosTotal: pT };
  }, [schema, answers, property, errorIds]);

  const sectionProgress = React.useCallback(
    (sectionId: string) => progressBySection.get(sectionId),
    [progressBySection]
  );

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
          <div className="flex items-center justify-between gap-2">
            <p className="e-eyebrow flex items-center gap-1.5">
              <ClipboardCheck className="h-3.5 w-3.5" /> {template?.name || "Job form"}
            </p>
            <button
              type="button"
              onClick={reportException}
              className="inline-flex items-center gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-warning))] underline-offset-2 hover:underline"
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Report an exception
            </button>
          </div>
          <FormRenderer
            schema={schema}
            answers={answers}
            uploads={uploads}
            property={property}
            onAnswer={api.onAnswer}
            onUpload={api.onUpload}
            disabled={locked}
            collapsibleSections
            sectionProgress={sectionProgress}
          />
        </div>
      ) : (
        <EAlert tone="warning" title="No form template">
          No active form template is configured for this job type — you can still clock in/out and complete the checklist.
        </EAlert>
      )}
    </div>
  );
}
