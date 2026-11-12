"use client";

/**
 * "Ask cleaner to buy": choose a cleaner on the next clean at the property (or
 * any active cleaner), the quantity, a note and the transports. The inbox is
 * ticked by default and alone; push and email are only sent when ticked. After
 * sending, each transport's real state is shown ("queued", "in the inbox"),
 * never "delivered". The need then reads "Asked", not "Bought".
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { AskCandidates, AskTransport, CreatedAsk } from "@/lib/inventory/urgent-stock-ask";
import type { RecipientOutcome } from "@/lib/notifications/office-sends";
import { newRequestId } from "./urgent-api";

export type AskNeed = { id: string; itemName: string; propertyName: string; unit: string; purchaseQuantity: number | null; suggestedBuy: number | null };

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: AskCandidates };
type Save = { status: "idle" } | { status: "saving" } | { status: "failed"; message: string } | { status: "done"; ask: CreatedAsk; outcomes: RecipientOutcome[] };

const TRANSPORT_LABEL: Record<AskTransport, string> = { INBOX: "In-app inbox", PUSH: "Phone and browser push", EMAIL: "Email" };
const STATE_LABEL: Record<string, string> = {
  queued: "queued", inbox_available: "in the inbox", provider_accepted: "accepted by the provider", requested: "requested", already_requested: "already requested",
  uncertain: "outcome unknown", skipped: "skipped", failed: "failed", switched_off: "switched off",
};

export function AskCleanerDialog({ need, onClose, onDone }: { need: AskNeed; onClose: () => void; onDone: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [cleanerId, setCleanerId] = React.useState("");
  const [quantity, setQuantity] = React.useState(() => String(need.purchaseQuantity ?? need.suggestedBuy ?? ""));
  const [note, setNote] = React.useState("");
  const [transports, setTransports] = React.useState<AskTransport[]>(["INBOX"]);
  const [save, setSave] = React.useState<Save>({ status: "idle" });
  const requestKey = React.useRef<{ key: string; id: string } | null>(null);
  const saving = save.status === "saving";

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/inventory/urgent-stock/asks?needId=${encodeURIComponent(need.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (AskCandidates & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.cleaners) throw new Error(body?.error ?? "Could not load cleaners.");
        setLoad({ status: "ready", value: body });
        const first = body.nextJob?.cleaners[0]?.id;
        if (first) setCleanerId(first);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load cleaners." });
      });
    return () => controller.abort();
  }, [need.id]);

  const nextJob = load.status === "ready" ? load.value.nextJob : null;
  const onNextJob = Boolean(nextJob?.cleaners.some((cleaner) => cleaner.id === cleanerId));

  function toggle(transport: AskTransport) {
    setTransports((current) => current.includes(transport) ? current.filter((item) => item !== transport) : [...current, transport]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(quantity);
    const body = {
      needId: need.id, cleanerId, jobId: onNextJob && nextJob ? nextJob.id : null,
      quantity: quantity.trim() && Number.isFinite(value) && value > 0 ? value : null,
      note: note.trim() || null, transports,
    };
    const key = JSON.stringify(body);
    if (requestKey.current?.key !== key) requestKey.current = { key, id: newRequestId() };
    setSave({ status: "saving" });
    try {
      const response = await fetch("/api/inventory/urgent-stock/asks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, requestKey: requestKey.current.id }) });
      const result = (await response.json().catch(() => null)) as { ask?: CreatedAsk; outcomes?: RecipientOutcome[]; error?: string } | null;
      if (!response.ok || !result?.ask) throw new Error(result?.error ?? `Not sent (${response.status}).`);
      requestKey.current = null;
      setSave({ status: "done", ask: result.ask, outcomes: result.outcomes ?? [] });
      onDone();
    } catch (error) {
      setSave({ status: "failed", message: error instanceof Error ? error.message : "Not sent." });
    }
  }

  return (
    <EModal open onClose={() => (saving ? undefined : onClose())} eyebrow={`${need.itemName} · ${need.propertyName}`} title="Ask cleaner to buy">
      {save.status === "done" ? (
        <div className="space-y-3 text-[0.875rem]">
          <p>Asked {save.ask.cleanerName} to buy {save.ask.quantity} {save.ask.unit}. The need shows &ldquo;Asked&rdquo; until they answer; it shows &ldquo;Bought&rdquo; only after their shopping run is submitted and you approve the reimbursement.</p>
          <ul aria-label="Notice" className="space-y-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {save.outcomes.map((outcome, index) => <li key={index}>{outcome.transport.replace("_", " ").toLowerCase()}: {STATE_LABEL[outcome.state] ?? outcome.state}{outcome.errorCode ? ` (${outcome.errorCode.replace(/_/g, " ")})` : ""}</li>)}
          </ul>
          <div className="flex justify-end border-t border-[hsl(var(--e-border))] pt-4"><EButton size="sm" onClick={onClose}>Close</EButton></div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-3">
            {load.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading cleaners…</p> : null}
            {load.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
            {load.status === "ready" ? (
              <>
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {nextJob ? `Next clean: ${nextJob.jobNumber ?? "job"}${nextJob.cleaners.length ? "" : " (no cleaner assigned yet)"}.` : "No upcoming clean at this property."} If they accept, it goes on their shopping run and the office approves the reimbursement.
                </p>
                <EField label="Cleaner">
                  <ESelect required value={cleanerId} onChange={(event) => setCleanerId(event.target.value)}>
                    <option value="">Choose a cleaner</option>
                    {nextJob?.cleaners.length ? (
                      <optgroup label="On the next clean">{nextJob.cleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}</option>)}</optgroup>
                    ) : null}
                    <optgroup label="All cleaners">{load.value.cleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}</option>)}</optgroup>
                  </ESelect>
                </EField>
              </>
            ) : null}
            <EField label={`How many (${need.unit})`} hint={quantity ? undefined : "No requested quantity or suggestion: enter one."}>
              <EInput required type="number" min="0.001" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </EField>
            <EField label="Note to the cleaner (optional)"><ETextarea maxLength={1000} rows={2} value={note} onChange={(event) => setNote(event.target.value)} /></EField>
            <fieldset>
              <legend className="mb-1 text-[0.75rem] font-[600] text-[hsl(var(--e-muted-foreground))]">Send by</legend>
              {(Object.keys(TRANSPORT_LABEL) as AskTransport[]).map((transport) => (
                <label key={transport} className="flex items-center gap-2 text-[0.8125rem]">
                  <input type="checkbox" checked={transports.includes(transport)} onChange={() => toggle(transport)} /> {TRANSPORT_LABEL[transport]}
                </label>
              ))}
            </fieldset>
            {save.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton type="button" size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
              <EButton type="submit" size="sm" disabled={!cleanerId || transports.length === 0 || load.status !== "ready"}>{saving ? "Sending…" : "Ask"}</EButton>
            </div>
          </fieldset>
        </form>
      )}
    </EModal>
  );
}
