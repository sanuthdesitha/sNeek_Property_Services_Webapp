"use client";

/**
 * "Report a need" — the existing report form (property, item, observed count
 * and when, purchase quantity, note) in a dialog. Unknown quantities stay
 * blank and are saved as unknown, never zero. Changing property clears the
 * item; a failed save keeps everything typed and its request id.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { countOrNull, localInputToIso, newRequestId, postUrgentStock } from "./urgent-api";

type Option = { id: string; name: string };
type ItemOption = { itemId: string; item: { name: string; unit: string } };
type Draft = { propertyId: string; itemId: string; observed: string; observedAt: string; purchase: string; note: string };

const EMPTY: Draft = { propertyId: "", itemId: "", observed: "", observedAt: "", purchase: "", note: "" };

export function ReportNeedDialog({ open, initialPropertyId, onClose, onReported }: { open: boolean; initialPropertyId: string; onClose: () => void; onReported: () => void }) {
  const [draft, setDraft] = React.useState<Draft>({ ...EMPTY, propertyId: initialPropertyId });
  const [properties, setProperties] = React.useState<Option[] | null>(null);
  const [items, setItems] = React.useState<ItemOption[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // One request id per distinct submission, kept until it succeeds: a retry of
  // the same input is recorded once; edited input is a new request.
  const receipts = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const query = draft.propertyId ? `?propertyId=${encodeURIComponent(draft.propertyId)}` : "";
    setItems(null);
    fetch(`/api/inventory/urgent-stock${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { properties?: Option[]; items?: ItemOption[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.properties) throw new Error(body?.error ?? "Could not load properties.");
        setProperties(body.properties);
        setItems(draft.propertyId ? body.items ?? [] : null);
        setLoadError(null);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : "Could not load properties.");
      });
    return () => controller.abort();
  }, [open, draft.propertyId]);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = {
        propertyId: draft.propertyId,
        itemId: draft.itemId,
        observedCount: countOrNull(draft.observed),
        observedAt: localInputToIso(draft.observedAt),
        purchaseQuantity: countOrNull(draft.purchase),
        note: draft.note,
      };
      const fingerprint = JSON.stringify(input);
      const requestId = receipts.current.get(fingerprint) ?? newRequestId();
      receipts.current.set(fingerprint, requestId);
      await postUrgentStock({ action: "report", requestId, ...input });
      receipts.current.delete(fingerprint);
      setDraft({ ...EMPTY, propertyId: draft.propertyId });
      onReported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open={open} onClose={() => (saving ? undefined : onClose())} eyebrow="Urgent needs" title="Report a need" size="wide">
      <form onSubmit={submit}>
        <fieldset disabled={saving} className="space-y-3">
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Leave unknown quantities blank. Reporting a need does not buy anything; it stays open until it is resolved.</p>
          {loadError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{loadError}</p> : null}
          <EField label="Property">
            <ESelect required value={draft.propertyId} onChange={(event) => patch({ propertyId: event.target.value, itemId: "" })}>
              <option value="">{properties ? "Choose property" : "Loading properties…"}</option>
              {(properties ?? []).map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
            </ESelect>
          </EField>
          <EField label="Item">
            <ESelect required value={draft.itemId} disabled={!draft.propertyId || items === null} onChange={(event) => patch({ itemId: event.target.value })}>
              <option value="">{!draft.propertyId ? "Choose a property first" : items === null ? "Loading items…" : items.length ? "Choose item" : "No configured inventory items"}</option>
              {(items ?? []).map((item) => <option key={item.itemId} value={item.itemId}>{item.item.name} ({item.item.unit})</option>)}
            </ESelect>
          </EField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Observed count (blank = unknown)"><EInput type="number" min="0" max="1000000" step="any" value={draft.observed} onChange={(event) => patch({ observed: event.target.value })} /></EField>
            <EField label="When that count was observed"><EInput type="datetime-local" step="1" required={draft.observed !== ""} value={draft.observedAt} onChange={(event) => patch({ observedAt: event.target.value })} /></EField>
          </div>
          <EField label="Purchase quantity requested (blank = unknown)"><EInput type="number" min="0.001" max="1000000" step="any" value={draft.purchase} onChange={(event) => patch({ purchase: event.target.value })} /></EField>
          <EField label="What is needed and why?"><ETextarea required maxLength={2000} value={draft.note} onChange={(event) => patch({ note: event.target.value })} /></EField>
          {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton type="button" size="sm" variant="outline" onClick={onClose}>Cancel</EButton>
            <EButton type="submit" size="sm">{saving ? "Saving…" : "Save report"}</EButton>
          </div>
        </fieldset>
      </form>
    </EModal>
  );
}
