"use client";

/**
 * The pickup answers on the stop screen (board 2 "Stop"): "Was the linen
 * ready?", bags picked up with a stepper against the expected count, pickup
 * photo, key photo and a bag QR check. Same endpoint and rules as the pickup
 * dialog (POST /api/laundry/[taskId]/status, PICKED_UP):
 * - a count different from the cleaner's expected count needs a reason and a
 *   pickup photo, and opens an office review (server side);
 * - readiness is required when the cleaner did not confirm the bags;
 * - a 409 or no answer means the outcome is unknown: refresh before trying again.
 * The answers are kept on this phone (per login and stop) until they are sent.
 */
import { tourTarget } from "@/lib/tutorials/targets";
import * as React from "react";
import { QrCode } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import { decodeQrFromFile } from "@/components/v2/laundry/laundry-board";
import { pickupNeedsReadinessAnswer } from "@/lib/laundry/pickup-readiness";
import type { PickupDraft, useStopDraft } from "./use-stop-draft";

export type PickupFormTask = { id: string; status: string; updatedAt?: string | null; propertyName: string };
type Outcome = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "unknown" };

const textareaClass = "mt-1 w-full rounded-[10px] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] p-2 text-[16px]";

function Segmented({ value, onChange, disabled }: { value: PickupDraft["readiness"]; onChange: (value: "READY" | "NOT_READY") => void; disabled: boolean }) {
  const options: Array<["READY" | "NOT_READY", string]> = [["READY", "Yes"], ["NOT_READY", "No, not ready"]];
  return (
    <div role="radiogroup" aria-label="Was the linen ready?" className="flex gap-0.5 rounded-[10px] bg-[hsl(var(--e-surface-sunken,var(--e-muted)))] p-[3px]">
      {options.map(([id, label]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} disabled={disabled} onClick={() => onChange(id)} className={`min-h-11 flex-1 rounded-[8px] text-[0.875rem] ${value === id ? "bg-[hsl(var(--e-surface))] font-[600] shadow-sm" : "text-[hsl(var(--e-text-secondary))]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center overflow-hidden rounded-[10px] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))]">
      <button type="button" aria-label="One bag fewer" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} className="h-11 w-12 text-[1.125rem]">−</button>
      <output aria-live="polite" aria-label="Bags picked up" className="w-14 text-center font-serif text-[1.375rem]">{value}</output>
      <button type="button" aria-label="One bag more" disabled={disabled || value >= 50} onClick={() => onChange(value + 1)} className="h-11 w-12 text-[1.125rem]">+</button>
    </div>
  );
}

type Props = { task: PickupFormTask; expected: number | null; baselineId: string | null; draftState: ReturnType<typeof useStopDraft>; onDone: () => void; onFailedPickup: () => void };

export function StopPickupForm({ task, expected, baselineId, draftState, onDone, onFailedPickup }: Props) {
  const { draft, update, clear } = draftState;
  const [outcome, setOutcome] = React.useState<Outcome>({ status: "idle" });
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const [qr, setQr] = React.useState<{ status: "idle" | "reading" } | { status: "match" | "other" | "none" | "error"; text: string }>({ status: "idle" });
  const reasonId = React.useId();
  const sending = outcome.status === "sending";
  const locked = sending || outcome.status === "unknown";
  const differs = expected !== null && draft.bagCount !== expected;
  const readinessRequired = pickupNeedsReadinessAnswer(task.status);

  async function scan(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setQr({ status: "reading" });
    try {
      const value = await decodeQrFromFile(file);
      if (!value) setQr({ status: "none", text: "No QR code was found in that photo." });
      else if (value === task.id) setQr({ status: "match", text: "Bag label matches this run." });
      else setQr({ status: "other", text: "This bag label belongs to another run. Check the bag before you take it." });
    } catch {
      setQr({ status: "error", text: "Could not read that photo." });
    }
  }

  async function confirm() {
    if (readinessRequired && !draft.readiness) return setOutcome({ status: "failed", message: "Was the linen ready? The cleaner did not confirm it, so tell us what you found." });
    if (differs && (!draft.reason.trim() || !draft.photos[0]?.key)) return setOutcome({ status: "failed", message: `The count differs from ${expected}. Add a reason and a pickup photo; the office reviews it.` });
    if (photoBusy) return setOutcome({ status: "failed", message: "Wait for the photo to finish uploading." });
    setOutcome({ status: "sending" });
    const payload: Record<string, unknown> = {
      status: "PICKED_UP",
      confirm: true,
      expectedUpdatedAt: task.updatedAt ?? undefined,
      bagCount: draft.bagCount,
      quantityBaselineId: baselineId,
      ...(draft.readiness ? { pickupReadiness: draft.readiness } : {}),
      ...(differs ? { discrepancyReason: draft.reason.trim() } : {}),
      ...(draft.photos[0]?.key ? { pickupPhotoKey: draft.photos[0].key } : {}),
      ...(draft.keyPhotos[0]?.key ? { pickupKeyPhotoKey: draft.keyPhotos[0].key } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    };
    try {
      const response = await fetch(`/api/laundry/${encodeURIComponent(task.id)}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = (await response.json().catch(() => null)) as { id?: string; status?: string; error?: string } | null;
      if (response.status === 409) return setOutcome({ status: "unknown" });
      if (!response.ok) return setOutcome({ status: "failed", message: body?.error ?? `Not sent (${response.status}). Your answers are kept.` });
      if (body?.id !== task.id || body.status !== "PICKED_UP") return setOutcome({ status: "unknown" });
      clear();
      onDone();
    } catch {
      setOutcome({ status: "unknown" });
    }
  }

  return (
    <div className="space-y-3">
      <fieldset disabled={locked} className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
        <div>
          <p className="mb-1 text-[0.75rem] font-[550]">Was the linen ready?{readinessRequired ? " (required)" : ""}</p>
          <Segmented value={draft.readiness} disabled={locked} onChange={(readiness) => update({ readiness })} />
        </div>
        <div {...tourTarget("laundry.stop.count")} className="flex items-center justify-between gap-2">
          <div><p className="text-[0.75rem] font-[550]">Bags picked up</p><p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{expected === null ? "Expected count not recorded" : `Expected ${expected}`}</p></div>
          <Stepper value={draft.bagCount} disabled={locked} onChange={(bagCount) => update({ bagCount })} />
        </div>
        {differs ? (
          <label htmlFor={reasonId} className="block text-[0.75rem] font-[550]">Why is it different? (required)
            <textarea id={reasonId} rows={2} className={textareaClass} value={draft.reason} onChange={(event) => update({ reason: event.target.value })} />
          </label>
        ) : null}
        <div>
          <p className="mb-1 text-[0.75rem] font-[550]">Pickup photo{differs ? " (required)" : ""}</p>
          <MediaCapture value={draft.photos} onChange={(photos: CapturedMedia[]) => update({ photos })} onBusyChange={setPhotoBusy} disabled={locked} mode="photo" folder="laundry/pickup" multiple={false} stamp={{ tag: "laundry", reference: task.propertyName, contextLabel: "Pickup photo" }} />
        </div>
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-[0.8125rem]">Key photo and note (optional)</summary>
          <MediaCapture value={draft.keyPhotos} onChange={(keyPhotos: CapturedMedia[]) => update({ keyPhotos })} disabled={locked} mode="photo" folder="laundry/key" multiple={false} stamp={{ tag: "laundry", reference: task.propertyName, contextLabel: "Key photo (pickup)" }} />
          <textarea aria-label="Note for the office" rows={2} className={textareaClass} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} />
        </details>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-dashed border-[hsl(var(--e-border-strong))] px-3 text-[0.8125rem]">
          <QrCode className="h-4 w-4" aria-hidden /> {qr.status === "reading" ? "Reading…" : "Scan bag QR"}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={async (event) => { const input = event.currentTarget; await scan(input.files); input.value = ""; }} />
        </label>
        {"text" in qr ? <p role="status" className={`text-[0.75rem] ${qr.status === "match" ? "text-[hsl(var(--e-success))]" : "text-[hsl(var(--e-warning))]"}`}>{qr.text}</p> : null}
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{expected === null ? "No expected count was recorded, so any count is accepted." : `Count differs from ${expected}? A reason and a photo become required, and the office reviews it.`}</p>
      </fieldset>
      {outcome.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{outcome.message}</p> : null}
      {outcome.status === "unknown" ? (
        <div role="alert" className="space-y-2 text-[0.8125rem]">
          <p>The pickup may or may not have been recorded (no answer, or the run changed). Your answers are kept. Refresh to see the run before trying again.</p>
          <EButton variant="outline" className="min-h-11" onClick={() => window.location.reload()}>Refresh</EButton>
        </div>
      ) : null}
      <div className="sticky bottom-16 z-10 space-y-1.5 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] py-2.5 lg:static">
        <EButton {...tourTarget("laundry.stop.confirm")} className="min-h-12 w-full justify-center text-[0.9375rem]" disabled={locked || photoBusy} onClick={() => void confirm()}>
          {sending ? "Sending…" : `Confirm pickup · ${draft.bagCount} bag${draft.bagCount === 1 ? "" : "s"}`}
        </EButton>
        <EButton {...tourTarget("laundry.stop.failed")} variant="ghost" className="min-h-11 w-full justify-center" disabled={locked} onClick={onFailedPickup}>Pickup failed, report it</EButton>
      </div>
    </div>
  );
}
