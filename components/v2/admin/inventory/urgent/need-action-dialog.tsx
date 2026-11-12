"use client";

/**
 * Records one action on a need: the next stage (Acknowledge, Mark ordered,
 * Mark delivered), a property confirmation with a fresh count, or an
 * administrator resolution. Every action needs a reason, as the service
 * requires; the suggested wording is editable. Nothing here places an order or
 * proves a delivery. The form is frozen while saving and keeps what was typed
 * (and its request id) if the save fails.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import { URGENT_STAGE_RECORDED, urgentNextAction } from "@/lib/inventory/urgent-stock-actions";
import type { UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";
import type { UrgentNeed } from "@/lib/inventory/urgent-stock";
import { countOrNull, localInputToIso, newRequestId, postUrgentStock } from "./urgent-api";

export type NeedRef = { id: string; version: number; stage: UrgentStockStage; itemName: string; propertyName: string; unit: string };
export type NeedActionMode = "next" | "confirm" | "resolve";

const TITLE: Record<NeedActionMode, string> = { next: "", confirm: "Confirm at the property", resolve: "Resolve as administrator" };

function targetFor(need: NeedRef, mode: NeedActionMode): UrgentStockStage | null {
  if (mode === "confirm") return "PROPERTY_CONFIRMED";
  if (mode === "resolve") return "ADMIN_RESOLVED";
  const next = urgentNextAction(need.stage);
  return next.kind === "transition" ? next.to : null;
}

export function NeedActionDialog({ need, mode, onClose, onDone }: { need: NeedRef; mode: NeedActionMode; onClose: () => void; onDone: (updated: UrgentNeed) => void }) {
  const next = urgentNextAction(need.stage);
  const target = targetFor(need, mode);
  const [reason, setReason] = React.useState(mode === "next" && next.kind === "transition" ? next.reason : "");
  const [count, setCount] = React.useState("");
  const [observedAt, setObservedAt] = React.useState("");
  const [resolved, setResolved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // One request id per distinct submission, kept until it succeeds.
  const receipts = React.useRef(new Map<string, string>());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      const confirming = target === "PROPERTY_CONFIRMED";
      const input = {
        reportId: need.id,
        expectedVersion: need.version,
        stage: target,
        reason,
        observedCount: confirming ? countOrNull(count) : null,
        observedAt: confirming ? localInputToIso(observedAt) : null,
        needResolved: confirming && resolved,
      };
      const fingerprint = JSON.stringify(input);
      const requestId = receipts.current.get(fingerprint) ?? newRequestId();
      receipts.current.set(fingerprint, requestId);
      const updated = await postUrgentStock({ action: "transition", requestId, ...input });
      receipts.current.delete(fingerprint);
      onDone(updated);
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "next" && next.kind === "transition" ? next.label : TITLE[mode];
  return (
    <EModal open onClose={() => (saving ? undefined : onClose())} eyebrow={`${need.itemName} · ${need.propertyName}`} title={title}>
      {!target ? (
        <p className="text-[0.875rem]">There is no next step to record at this stage.</p>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Records &ldquo;{URGENT_STAGE_RECORDED[target]}&rdquo; with your name. It does not place an order, buy anything or prove a delivery.
            </p>
            {target === "PROPERTY_CONFIRMED" ? (
              <>
                <EField label={`Fresh count at the property (${need.unit})`}><EInput required type="number" min="0.001" max="1000000" step="any" value={count} onChange={(event) => setCount(event.target.value)} /></EField>
                <EField label="When it was counted"><EInput required type="datetime-local" step="1" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></EField>
                <label className="flex items-start gap-2 text-[0.8125rem]">
                  <input required type="checkbox" checked={resolved} onChange={(event) => setResolved(event.target.checked)} className="mt-0.5" />
                  The property was checked and this need is resolved
                </label>
              </>
            ) : null}
            <EField label="Reason">
              <ETextarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
            </EField>
            {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton type="button" size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
              <EButton type="submit" size="sm" disabled={!reason.trim()}>{saving ? "Saving…" : "Record"}</EButton>
            </div>
          </fieldset>
        </form>
      )}
    </EModal>
  );
}
