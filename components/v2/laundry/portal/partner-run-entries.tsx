"use client";

/**
 * Laundry partner portal entries (board "Laundry partner portal", 3 Tracking
 * and 4 From the office; owner decision 2026-11-13). All OPTIONAL:
 *  - "Add weight / price" while the set is at the laundry (before drop-off);
 *  - "Ready to return" on a picked-up set;
 *  - "Add drop-off photo" on a finished drop-off (append only).
 * Each sends the run version the screen saw (`expectedUpdatedAt`); a changed
 * run is refused and the typed draft is kept. Fields freeze while sending.
 * A draft survives collapsing the disclosure and is reset when the run
 * changes (another task id).
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import { canAddDropoffPhoto, canAddWeightPrice, canMarkReadyToReturn } from "@/lib/laundry/partner-entry-rules";
import { READY_TO_RETURN_LABEL } from "@/lib/laundry/status-groups";

export type PartnerEntryTask = {
  id: string;
  status: string;
  updatedAt?: string | Date | null;
  bagWeightKg?: number | null;
  dropoffCostAud?: number | null;
  propertyName: string;
};

type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "saved"; message: string };

type WeightPriceDraft = { weight: string; price: string };

const inputClass = "mt-0.5 h-11 w-full rounded-[10px] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[16px]";

function versionOf(task: PartnerEntryTask): string | null {
  if (!task.updatedAt) return null;
  const date = new Date(task.updatedAt);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function postEntry(path: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) return { ok: false, message: payload?.error ?? `Not saved (${response.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, message: "No signal or no answer. It may or may not have been saved; refresh before trying again." };
  }
}

/** Parse an optional positive number field; "" is "not given", never zero. */
export function parseOptionalPositive(value: string): { ok: true; value: number | undefined } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

function WeightPriceForm({ task, onSaved }: { task: PartnerEntryTask; onSaved: () => void }) {
  const [draft, setDraft] = React.useState<WeightPriceDraft>({ weight: "", price: "" });
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const ids = { weight: React.useId(), price: React.useId() };
  const sending = send.status === "sending";
  const recorded = [task.bagWeightKg != null ? `${task.bagWeightKg} kg` : null, task.dropoffCostAud != null ? `$${Number(task.dropoffCostAud).toFixed(2)}` : null].filter(Boolean).join(" · ");

  async function submit() {
    const weight = parseOptionalPositive(draft.weight);
    const price = parseOptionalPositive(draft.price);
    if (!weight.ok || !price.ok) return setSend({ status: "failed", message: "Enter numbers above 0, or leave a field empty." });
    if (weight.value === undefined && price.value === undefined) return setSend({ status: "failed", message: "Enter a weight, a price, or both." });
    const version = versionOf(task);
    if (!version) return setSend({ status: "failed", message: "Refresh this run before adding details." });
    setSend({ status: "sending" });
    const result = await postEntry(`/api/laundry/${encodeURIComponent(task.id)}/weight-price`, {
      ...(weight.value !== undefined ? { weightKg: weight.value } : {}),
      ...(price.value !== undefined ? { price: price.value } : {}),
      expectedUpdatedAt: version,
    });
    if (!result.ok) return setSend({ status: "failed", message: result.message });
    setDraft({ weight: "", price: "" });
    setSend({ status: "saved", message: "Saved. The office sees it on the run." });
    onSaved();
  }

  return (
    <details className="rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-1">
      <summary className="min-h-11 cursor-pointer py-2 text-[0.8125rem] font-[600]">Add weight / price <span className="font-[400] text-[hsl(var(--e-muted-foreground))]">(optional)</span></summary>
      <fieldset disabled={sending} className="space-y-2 pb-2">
        {recorded ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Recorded now: {recorded}. A new value replaces it; leave a field empty to keep it.</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <label htmlFor={ids.weight} className="text-[0.75rem] font-[550]">Weight (kg)
            <input id={ids.weight} type="number" inputMode="decimal" min={0} step="0.1" className={inputClass} value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} />
          </label>
          <label htmlFor={ids.price} className="text-[0.75rem] font-[550]">Your price ($)
            <input id={ids.price} type="number" inputMode="decimal" min={0} step="0.01" className={inputClass} value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
          </label>
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Your price for this load. The office checks it; it does not change any invoice.</p>
        <EButton size="sm" className="min-h-11 w-full justify-center" onClick={() => void submit()}>{sending ? "Saving…" : send.status === "failed" ? "Try again" : "Save weight / price"}</EButton>
        {send.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{send.message}</p> : null}
        {send.status === "saved" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-success))]">{send.message}</p> : null}
      </fieldset>
    </details>
  );
}

function ReadyToReturnButton({ task, onSaved }: { task: PartnerEntryTask; onSaved: () => void }) {
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  async function submit() {
    const version = versionOf(task);
    if (!version) return setSend({ status: "failed", message: "Refresh this run first." });
    setSend({ status: "sending" });
    const result = await postEntry(`/api/laundry/${encodeURIComponent(task.id)}/ready-to-return`, { expectedUpdatedAt: version });
    if (!result.ok) return setSend({ status: "failed", message: result.message });
    setSend({ status: "saved", message: "Marked ready to return." });
    onSaved();
  }
  return (
    <div className="space-y-1">
      <EButton size="sm" variant="outline" className="min-h-11 w-full justify-center" disabled={send.status === "sending"} onClick={() => void submit()}>
        {send.status === "sending" ? "Saving…" : READY_TO_RETURN_LABEL}
      </EButton>
      {send.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "saved" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-success))]">{send.message}</p> : null}
    </div>
  );
}

export function DropoffPhotoForm({ task, onSaved, defaultOpen = false }: { task: PartnerEntryTask; onSaved: () => void; defaultOpen?: boolean }) {
  const [photos, setPhotos] = React.useState<CapturedMedia[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const sending = send.status === "sending";

  async function submit() {
    const keys = photos.map((photo) => photo.key).filter((key): key is string => typeof key === "string" && key.length > 0);
    if (!keys.length) return setSend({ status: "failed", message: "Take or choose a photo first." });
    const version = versionOf(task);
    if (!version) return setSend({ status: "failed", message: "Refresh this run first." });
    setSend({ status: "sending" });
    const result = await postEntry(`/api/laundry/${encodeURIComponent(task.id)}/dropoff-photos`, { photoKeys: keys, expectedUpdatedAt: version });
    if (!result.ok) return setSend({ status: "failed", message: result.message });
    setPhotos([]);
    setSend({ status: "saved", message: "Photo added to the drop-off. The earlier record is kept." });
    onSaved();
  }

  return (
    <details open={defaultOpen || undefined} className="rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-1">
      <summary className="min-h-11 cursor-pointer py-2 text-[0.8125rem] font-[600]">Add drop-off photo <span className="font-[400] text-[hsl(var(--e-muted-foreground))]">(optional)</span></summary>
      <div className="space-y-2 pb-2">
        <MediaCapture value={photos} onChange={setPhotos} onBusyChange={setUploading} disabled={sending} mode="photo" folder="laundry/dropoff" multiple stamp={{ tag: "laundry", reference: task.propertyName, contextLabel: "Drop-off photo (added later)" }} />
        <EButton size="sm" className="min-h-11 w-full justify-center" disabled={sending || uploading} onClick={() => void submit()}>{sending ? "Adding…" : uploading ? "Uploading…" : send.status === "failed" ? "Try again" : "Add to drop-off"}</EButton>
        {send.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{send.message}</p> : null}
        {send.status === "saved" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-success))]">{send.message}</p> : null}
      </div>
    </details>
  );
}

/**
 * The entries that apply to the run's current status. Keyed by task id by the
 * caller so a different run starts with empty drafts.
 */
export function PartnerRunEntries({ task, onSaved }: { task: PartnerEntryTask; onSaved: () => void }) {
  const weightPrice = canAddWeightPrice(task.status);
  const ready = canMarkReadyToReturn(task.status);
  const photo = canAddDropoffPhoto(task.status);
  if (!weightPrice && !ready && !photo) return null;
  return (
    <div className="space-y-2">
      {weightPrice ? <WeightPriceForm task={task} onSaved={onSaved} /> : null}
      {ready ? <ReadyToReturnButton task={task} onSaved={onSaved} /> : null}
      {photo ? <DropoffPhotoForm task={task} onSaved={onSaved} /> : null}
    </div>
  );
}
