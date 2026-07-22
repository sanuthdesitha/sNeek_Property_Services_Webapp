"use client";

/**
 * Stage 5 — Wrap up (and the submitted/locked review state). Re-homes the
 * existing wrap-up cards in order: Laundry (turnover-only, incl. early-send),
 * a restock/inventory summary, Pass to next clean, then SUBMIT. Below submit,
 * the live validation errors render as tappable rows that switch to the right
 * stage and scroll to the offending field.
 *
 * All state + handlers come from the workspace unchanged. The final
 * self-inspection form section remains the last section of the Clean accordion
 * (a single controlled FormRenderer instance) so its field ids, state and
 * validation are untouched — see the report note.
 */
import * as React from "react";
import {
  WashingMachine,
  Forward,
  Plus,
  Trash2,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Check,
  Loader2,
  Package,
  Square,
} from "lucide-react";
import Link from "next/link";
import { EBadge, EButton, ECard, ECardBody, EAlert } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import { formatDuration } from "@/lib/time/format-duration";
import { LAUNDRY_SKIP_REASONS, type WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

const LAUNDRY_CARD_ID = "wrapup-laundry";

/** Human labels for the locked "sent" summary. */
const LAUNDRY_OUTCOME_LABELS: Record<string, string> = {
  READY_FOR_PICKUP: "Ready for pickup",
  NOT_READY: "Not ready",
  NO_PICKUP_REQUIRED: "No pickup required",
};

export function StageWrapup({ api }: { api: WorkspaceApi }) {
  const {
    locked,
    status,
    laundryEnabled,
    schema,
    answers,
    uploads,
    property,
    jobTasks,
    taskDrafts,
    allTasksDecided,
    busy,
    addressLine,
  } = api;

  // Locked → the submitted review state is the whole stage (design "Job
  // submitted" screen: confirmation, quality-pending, time on site, back home).
  if (locked) {
    const onSiteSeconds = Number(api.timeState?.completedSeconds ?? 0);
    const payForJob: number | null =
      api.payload?.payForJob != null && Number.isFinite(Number(api.payload.payForJob))
        ? Number(api.payload.payForJob)
        : null;
    const fmtAud = (n: number) =>
      `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return (
      <div className="space-y-5">
        <ECard>
          <ECardBody className="space-y-4 pt-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-[hsl(var(--e-success))]" />
            <div>
              <p className="e-serif text-[1.375rem] font-[650] leading-tight">Job submitted</p>
              <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
                {api.propertyCode ? `${api.propertyCode} — ` : ""}
                {addressLine || "This job"} is done
                {status === "COMPLETED" ? " and completed" : ""}.
              </p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5 text-left">
              <p className="text-[0.8125rem]">
                Your quality score is{" "}
                <span className="font-[600]">pending review</span> — you'll see it in
                My performance.
              </p>
            </div>
            {onSiteSeconds > 0 || payForJob != null ? (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {onSiteSeconds > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="e-eyebrow">Time on site</span>
                    <span className="font-[600] tabular-nums text-[hsl(var(--e-text))]">
                      {formatDuration(onSiteSeconds)}
                    </span>
                  </span>
                ) : null}
                {payForJob != null ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="e-eyebrow">Pay for this job</span>
                    <span className="font-[600] tabular-nums text-[hsl(var(--e-text))]">
                      {fmtAud(payForJob)}
                    </span>
                  </span>
                ) : null}
              </div>
            ) : null}
            <Link href="/v2/cleaner" className="block">
              <EButton variant="gold" className="w-full">
                Back to Today
              </EButton>
            </Link>
          </ECardBody>
        </ECard>
      </div>
    );
  }

  // ── Outstanding form errors (for the tappable list below submit) ──────────
  const uploadCounts: Record<string, number> = {};
  for (const [fid, media] of Object.entries(uploads)) uploadCounts[fid] = media.length;
  const formErrors = schema
    ? collectFormErrors(
        schema,
        answers,
        uploadCounts,
        property ?? {},
        laundryEnabled ? api.laundryOutcome === "READY_FOR_PICKUP" : undefined
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

  return (
    <div className="space-y-5">
      {/* Laundry — turnover only */}
      {laundryEnabled ? (
        <ECard id={LAUNDRY_CARD_ID}>
          <ECardBody className="space-y-3 pt-6">
            <p className="e-eyebrow flex items-center gap-1.5">
              <WashingMachine className="h-3.5 w-3.5" /> Used linen — ready for pickup?
            </p>
            {api.laundryLocked ? (
              /* SENT: the update already went to the laundry team. Lock it to a
                 read-only summary (v1 parity) so it can't be silently changed —
                 and so submit doesn't transmit a second, different update.
                 "Edit update" is the deliberate way back into the form. */
              <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-success)/0.4)] bg-[hsl(var(--e-success)/0.06)] p-3">
                <p className="flex items-center gap-1.5 text-[0.875rem] font-[600] text-[hsl(var(--e-success))]">
                  <Check className="h-4 w-4" /> Laundry update sent
                </p>
                <dl className="space-y-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  <div className="flex gap-1.5">
                    <dt className="text-[hsl(var(--e-muted-foreground))]">Outcome:</dt>
                    <dd className="font-[550]">{LAUNDRY_OUTCOME_LABELS[api.laundryOutcome] ?? api.laundryOutcome}</dd>
                  </div>
                  {api.laundryOutcome === "READY_FOR_PICKUP" && api.laundryBagLocation ? (
                    <div className="flex gap-1.5">
                      <dt className="text-[hsl(var(--e-muted-foreground))]">Bag left at:</dt>
                      <dd className="font-[550]">{api.laundryBagLocation}</dd>
                    </div>
                  ) : null}
                  {api.laundryEarlySentAt ? (
                    <div className="flex gap-1.5">
                      <dt className="text-[hsl(var(--e-muted-foreground))]">Sent:</dt>
                      <dd className="font-[550]">{api.laundryEarlySentAt}</dd>
                    </div>
                  ) : null}
                </dl>
                <EButton variant="outline" size="sm" disabled={locked} onClick={api.beginLaundryEdit}>
                  Edit update
                </EButton>
              </div>
            ) : (
            <>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Tell the laundry service the used-linen bag is ready. They collect it — you don&apos;t take it.
              Saved when you submit and sent to the laundry team.
            </p>
            <EField label="Outcome (required)">
              <ESelect
                value={api.laundryOutcome}
                disabled={locked}
                onChange={(e) => api.setLaundryOutcome(e.target.value as any)}
              >
                <option value="">Select an outcome…</option>
                <option value="READY_FOR_PICKUP">Ready for pickup</option>
                <option value="NOT_READY">Not ready</option>
                <option value="NO_PICKUP_REQUIRED">No pickup required</option>
              </ESelect>
            </EField>
            {api.laundryOutcome === "READY_FOR_PICKUP" ? (
              <>
                <EField label="Bag location (required)">
                  {api.laundryBagLocationOptions.length > 0 ? (
                    <ESelect
                      value={api.laundryBagLocation}
                      disabled={locked}
                      onChange={(e) => api.setLaundryBagLocation(e.target.value)}
                    >
                      <option value="">Select where you left the bag…</option>
                      {api.laundryBagLocationOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                      {api.laundryBagLocation &&
                      !api.laundryBagLocationOptions.includes(api.laundryBagLocation) ? (
                        <option value={api.laundryBagLocation}>{api.laundryBagLocation}</option>
                      ) : null}
                    </ESelect>
                  ) : (
                    <EInput
                      placeholder="e.g. Laundry room shelf, labeled bags"
                      value={api.laundryBagLocation}
                      disabled={locked}
                      onChange={(e) => api.setLaundryBagLocation(e.target.value)}
                    />
                  )}
                </EField>
                <EField label="Laundry photo (required)">
                  <MediaCapture
                    value={api.laundryPhoto}
                    onChange={api.setLaundryPhoto}
                    mode="photo"
                    folder="laundry"
                    disabled={locked}
                    stamp={{
                      address: addressLine || undefined,
                      reference: (property?.name as string) || undefined,
                      tag: "laundry",
                      contextLabel: "Laundry bags ready for pickup",
                    }}
                  />
                </EField>
              </>
            ) : api.laundryOutcome ? (
              <>
                <EField label="Reason (required)">
                  <ESelect value={api.laundrySkipCode} disabled={locked} onChange={(e) => api.setLaundrySkipCode(e.target.value)}>
                    {LAUNDRY_SKIP_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </ESelect>
                </EField>
                <EField label="Note (optional)">
                  <ETextarea value={api.laundrySkipNote} disabled={locked} onChange={(e) => api.setLaundrySkipNote(e.target.value)} />
                </EField>
              </>
            ) : null}

            {api.laundryOutcome && !locked ? (
              <div className="space-y-1.5 border-t border-[hsl(var(--e-border))] pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Linen ready before the form is done? Send this status to the laundry team now.
                    {api.laundryEarlySentAt ? ` Last sent ${api.laundryEarlySentAt}.` : ""}
                  </p>
                  <EButton
                    variant="outline"
                    size="sm"
                    disabled={
                      api.laundryEarlySending ||
                      (api.laundryOutcome === "READY_FOR_PICKUP" &&
                        (!api.laundryBagLocation.trim() || api.laundryPhoto.length === 0))
                    }
                    onClick={() => api.sendLaundryEarlyUpdate()}
                  >
                    {api.laundryEarlySending ? "Sending…" : "Send to laundry team now"}
                  </EButton>
                </div>
                {api.laundryAmendedSinceSend ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-gold-ink))]">
                    You&apos;ve changed this since sending — the amendment goes with your submission.
                  </p>
                ) : null}
                {api.laundryEarlyNotice ? (
                  <p
                    className={`text-[0.75rem] ${
                      api.laundryEarlyNotice.tone === "success"
                        ? "text-[hsl(var(--e-success))]"
                        : "text-[hsl(var(--e-danger))]"
                    }`}
                  >
                    {api.laundryEarlyNotice.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            </>
            )}
          </ECardBody>
        </ECard>
      ) : null}

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
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => api.setCarryNotes((prev) => prev.filter((_, idx) => idx !== i))}
                      className="mt-2 shrink-0 text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-danger))] disabled:opacity-50"
                      aria-label="Remove note"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
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

      {/* Submit */}
      <ECard variant="ceremony">
        <ECardBody className="space-y-3 pt-6">
          {tasksPending ? (
            <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-warning))]">
              <AlertTriangle className="h-4 w-4" /> Mark every checklist item done or not done before submitting.
            </p>
          ) : null}
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Submitting sends the form + checklist for QA and records your clock-out.
          </p>
          <EButton
            variant="gold"
            className="w-full"
            disabled={busy === "submit" || tasksPending}
            onClick={() => api.submit()}
          >
            {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Submit &amp; clock out
          </EButton>

          {/* Tappable validation rows */}
          {formErrors.length > 0 || laundryErrors.length > 0 ? (
            <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] p-3">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                {formErrors.length + laundryErrors.length} item
                {formErrors.length + laundryErrors.length === 1 ? "" : "s"} to finish
              </p>
              <ul className="mt-2 space-y-1">
                {formErrors.map((err) => (
                  <li key={err.fieldId}>
                    <button
                      type="button"
                      onClick={() => jumpToFormField(err.fieldId)}
                      className="flex items-center gap-1.5 text-left text-[0.8125rem] text-[hsl(var(--e-danger))] underline-offset-2 hover:underline"
                    >
                      <EBadge tone="neutral" soft>
                        Clean
                      </EBadge>
                      {err.sectionLabel && err.sectionLabel !== err.label
                        ? `${stripHtmlToText(err.sectionLabel)}: ${stripHtmlToText(err.label)}`
                        : stripHtmlToText(err.label)}
                    </button>
                  </li>
                ))}
                {laundryErrors.map((msg, i) => (
                  <li key={`laundry-${i}`}>
                    <button
                      type="button"
                      onClick={jumpToLaundry}
                      className="flex items-center gap-1.5 text-left text-[0.8125rem] text-[hsl(var(--e-danger))] underline-offset-2 hover:underline"
                    >
                      <EBadge tone="neutral" soft>
                        Wrap up
                      </EBadge>
                      {msg}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {/* Clock out & finish later — admin-allowlisted only */}
      {api.payload?.canClockOutWithoutForm && api.hasStarted && !locked ? (
        <ECard className="border-[hsl(var(--e-warning))]">
          <ECardBody className="space-y-2 pt-6">
            <p className="text-[0.875rem] font-[550]">Clock out &amp; finish the form later</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Stops your clock now. This job stays open and is <strong>not counted as completed</strong> until you come
              back and submit the form.
            </p>
            <EButton
              variant="outline"
              className="w-full"
              disabled={busy === "clockout-early"}
              onClick={() => api.clockOutEarly()}
            >
              {busy === "clockout-early" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Clock out (finish form later)
            </EButton>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
