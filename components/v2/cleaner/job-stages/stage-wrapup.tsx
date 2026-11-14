"use client";

/**
 * Stage 5 — Wrap up (board state C "Submit review"; state D after submit).
 *
 * Order: "Before you submit" first (only the blockers, each a jump link, with
 * what is still on this phone kept apart), then Laundry handoff (turnover
 * only, incl. early-send), the restock tally, Pass to next clean and extra pay.
 * Submit sits in the sticky bottom bar with "Clock out (finish form later)"
 * as the secondary choice when the office allows it.
 *
 * All state + handlers come from the workspace unchanged. The final
 * self-inspection form section remains the last section of the Clean accordion
 * (a single controlled FormRenderer instance) so its field ids, state and
 * validation are untouched.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import * as React from "react";
import { Forward, HandCoins, Plus, Trash2, Camera, CheckCircle2, AlertTriangle, Loader2, Package, Square } from "lucide-react";
import Link from "next/link";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EConfirmButton } from "@/components/v2/admin/estate-kit";
import { ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { useSubmissionPreflight } from "@/components/v2/cleaner/use-submission-preflight";
import { DraftSaveStatus } from "@/components/v2/cleaner/draft-save-status";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";
import { LaundryHandoff, LAUNDRY_CARD_ID } from "@/components/v2/cleaner/job-stages/laundry-handoff";
import { SubmittedSummary } from "@/components/v2/cleaner/job-stages/submitted-summary";
import { SubmitBlockers } from "@/components/v2/cleaner/job-stages/submit-blockers";
import { StickyActionBar } from "@/components/v2/cleaner/job-stages/stage-footer";

export function StageWrapup({ api }: { api: WorkspaceApi }) {
  const { locked, laundryEnabled, schema, answers, uploads, property, jobTasks, allTasksDecided, busy, addressLine } = api;
  const syncBlockers = useSubmissionPreflight(!locked);
  if (api.bulkPool.length) syncBlockers.push("Assign or explicitly remove unfiled bulk photos before submitting.");
  if (api.laundryPhoto.length && (!laundryEnabled || api.laundryOutcome !== "READY_FOR_PICKUP")) syncBlockers.push("Laundry photos are unused by this outcome. Remove the attachment in device recovery; the original stays saved.");
  if (api.carryPhotos.length && (!api.carryHasNew || !api.carryNotes.some(note => note.trim()))) syncBlockers.push("Next-clean photos need a flag note or explicit attachment removal in device recovery.");
  if (api.payload?.formContractError) syncBlockers.push(api.payload.formContractError);

  // Locked → the submitted review state is the whole stage (board state D).
  if (locked) return <SubmittedSummary api={api} />;

  // ── Outstanding form errors (for the tappable list below submit) ──────────
  const uploadCounts: Record<string, number> = {};
  for (const [fid, media] of Object.entries(uploads)) uploadCounts[fid] = media.length;
  const formErrors = schema
    ? collectFormErrors(
        schema,
        answers,
        uploadCounts,
        property ?? {},
        laundryEnabled ? api.laundryOutcome === "READY_FOR_PICKUP" : undefined,
        api.requiredChecklistTicksBlockSubmit,
        {
          canUseNoPhoto: api.canUseNoPhoto,
          reasons:
            ((answers as Record<string, unknown>).__noPhotoReasons as Record<
              string,
              { reasonCode: string }
            >) ?? {},
        },
        { extended: api.enforceExtendedRules }
      )
    : [];

  // Laundry-gate errors (turnover only), mirroring the submit route rules.
  const laundryErrors: string[] = [];
  if (laundryEnabled) {
    if (!api.laundryOutcome) laundryErrors.push("Choose a laundry outcome.");
    else if (api.laundryOutcome === "READY_FOR_PICKUP") {
      if (!api.laundryBagLocation.trim()) laundryErrors.push("Bag location is required when laundry is ready.");
      if (api.laundryPhoto.length === 0) laundryErrors.push("A laundry photo is required when laundry is ready.");
    } else if (!api.laundrySkipCode) {
      laundryErrors.push("Select a reason when laundry isn't ready.");
    }
  }

  const tasksPending = jobTasks.length > 0 && !allTasksDecided;

  function jumpToFormField(fieldId: string) {
    api.setActiveStage(4);
    setTimeout(() => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sneek:focus-field", { detail: { match: fieldId } }));
      }
    }, 60);
  }

  function jumpToLaundry() {
    const el = document.getElementById(LAUNDRY_CARD_ID);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Restock summary (recorded as a form field in Clean — surface a tally here).
  const inventoryUsage = (answers.inventoryUsage as Record<string, unknown> | undefined) ?? {};
  const usedCount = Object.values(inventoryUsage).filter((v) => Number(v) > 0).length;

  const blockerCount = formErrors.length + laundryErrors.length + Number(tasksPending) + syncBlockers.length;
  const submitDisabled = Boolean(busy) || tasksPending || syncBlockers.length > 0;

  return (
    <div className="space-y-5">
      {/* Before you submit — first, so the blockers are seen before the forms below. */}
      <SubmitBlockers
        syncBlockers={syncBlockers}
        tasksPending={tasksPending}
        formErrors={formErrors}
        laundryErrors={laundryErrors}
        onJumpToTasks={() => api.setActiveStage(4)}
        onJumpToField={jumpToFormField}
        onJumpToLaundry={jumpToLaundry}
      >
        {api.draftSaveState && api.retryDraftSave ? <DraftSaveStatus state={api.draftSaveState} onRetry={api.retryDraftSave} /> : null}
        {busy ? <p role="status" className="text-sm">{busy === "submit" ? "Submitting; wait for confirmation before leaving." : "Another job action is in progress. Wait before submitting."}</p> : null}
        {api.timingRules?.earlyCheckin?.time ? (
          <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-warning))]">
            <AlertTriangle className="h-4 w-4" /> Early check-in — the property must be guest-ready
            before {api.timingRules.earlyCheckin.time}.
          </p>
        ) : null}
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {api.timeState?.isRunning ? "Submitting sends the form + checklist for QA and records your clock-out." : "Your clock is already stopped. Submitting sends the form + checklist for QA and keeps your recorded clock-out unchanged."}
          {api.finalCheckupItems.length > 0
            ? ` A quick final check-up (${api.finalCheckupItems.length} item${
                api.finalCheckupItems.length === 1 ? "" : "s"
              }) comes first.`
            : ""}
        </p>
      </SubmitBlockers>

      {/* Laundry — turnover only */}
      {laundryEnabled ? <LaundryHandoff api={api} /> : null}

      {/* Restock summary — the usage itself is recorded in the Clean form. */}
      {property?.inventoryEnabled === true ? (
        <ECard>
          <ECardBody className="flex items-center justify-between gap-3 pt-6">
            <p className="e-eyebrow flex items-center gap-1.5">
              <Package className="h-3.5 w-3.5" /> Restock used today
            </p>
            <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {usedCount > 0 ? `${usedCount} item${usedCount === 1 ? "" : "s"} recorded in Clean` : "None recorded"}
            </span>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Pass to next clean */}
      <ECard>
        <ECardBody className="space-y-3 pt-6">
          <p className="e-eyebrow flex items-center gap-1.5">
            <Forward className="h-3.5 w-3.5" /> Pass to next clean (optional)
          </p>
          <label className="flex items-start gap-2 text-[0.875rem]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
              checked={api.carryHasNew}
              disabled={locked}
              onChange={(e) => api.setCarryHasNew(e.target.checked)}
            />
            <span>Anything to flag for the next visit?</span>
          </label>
          {api.carryHasNew ? (
            <div className="space-y-3">
              {api.carryNotes.map((note, i) => (
                <div key={i} className="flex items-start gap-2">
                  <ETextarea
                    placeholder="e.g. Oven needs a deeper clean next time — ran out of time today"
                    value={note}
                    disabled={locked}
                    onChange={(e) =>
                      api.setCarryNotes((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                    }
                  />
                  {api.carryNotes.length > 1 ? (
                    /* Low tier: one unsaved carry-over note line. */
                    <EConfirmButton
                      disabled={locked}
                      ariaLabel="Remove note"
                      confirmLabel={<span className="text-[0.6875rem] font-[600]">Sure?</span>}
                      onConfirm={() => api.setCarryNotes((prev) => prev.filter((_, idx) => idx !== i))}
                      className="mt-2 shrink-0 text-[hsl(var(--e-danger))] disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </EConfirmButton>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                disabled={locked}
                onClick={() => api.setCarryNotes((prev) => [...prev, ""])}
                className="inline-flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] underline-offset-2 hover:underline disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add another flag
              </button>
              <div>
                <p className="mb-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  <Camera className="h-3.5 w-3.5" /> Photo (optional)
                </p>
                <MediaCapture
                  evidenceDestination={{ type: "carryForwardNew" }}
                  value={api.carryPhotos}
                  onChange={api.setCarryPhotos}
                  mode="photo"
                  folder="evidence"
                  multiple
                  disabled={locked}
                  stamp={{
                    address: addressLine || undefined,
                    reference: (property?.name as string) || undefined,
                    contextLabel: "Flag for next clean",
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Tick the box to leave notes or a photo for whoever cleans here next.
            </p>
          )}
        </ECardBody>
      </ECard>

      {/* Extra pay — quiet entry into the full pay-requests flow */}
      <ECard>
        <ECardBody className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="e-eyebrow flex items-center gap-1.5">
            <HandCoins className="h-3.5 w-3.5" /> Extra work today?
          </p>
          <EButton asChild variant="outline" size="sm">
            <Link href={`/v2/cleaner/pay-requests?jobId=${api.jobId}`}>
              <Plus className="h-3.5 w-3.5" /> Request extra pay
            </Link>
          </EButton>
        </ECardBody>
      </ECard>

      {/* One primary action, in thumb reach: Submit. Clock out & finish later
          (admin-allowlisted only) is the secondary choice beside it. */}
      <StickyActionBar>
        <EButton
          {...tourTarget("cleaner.job.submit")}
          variant="gold"
          className="min-h-11 w-full"
          disabled={submitDisabled}
          aria-describedby={blockerCount > 0 ? "wrapup-submit-hint" : undefined}
          onClick={() => api.requestSubmit()}
        >
          {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {api.timeState?.isRunning ? "Submit & clock out" : "Submit form"}
        </EButton>
        {blockerCount > 0 ? (
          <p id="wrapup-submit-hint" className="text-center text-[0.75rem] text-[hsl(var(--e-danger))]">
            Fix {blockerCount} item{blockerCount === 1 ? "" : "s"} first — listed under Before you submit.
          </p>
        ) : null}
        {api.payload?.canClockOutWithoutForm && api.hasStarted ? (
          <div className="space-y-1">
            <EButton
              variant="outline"
              className="min-h-11 w-full"
              disabled={busy === "clockout-early"}
              onClick={() => api.clockOutEarly()}
            >
              {busy === "clockout-early" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Clock out (finish form later)
            </EButton>
            <p className="text-center text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
              Stops your clock now. This job stays open and is <strong>not counted as completed</strong> until you come back and submit the form.
            </p>
          </div>
        ) : null}
      </StickyActionBar>
    </div>
  );
}
