"use client";

/**
 * Add or edit a stock supplier through the existing endpoints (unchanged):
 *   POST  /api/admin/inventory/suppliers       { name, email?, phone?, website?, defaultLeadDays, categories[], notes? }
 *   PATCH /api/admin/inventory/suppliers/[id]  { ...full supplier }
 * Fields freeze while saving; a failed save keeps the draft and says why.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import type { StockSupplierRecord } from "@/lib/suppliers/directory-types";

type Draft = { name: string; email: string; phone: string; website: string; defaultLeadDays: string; categories: string; notes: string; isActive: boolean };

export type StockEditorTarget = { mode: "create" } | { mode: "edit"; supplier: StockSupplierRecord };

function draftFor(target: StockEditorTarget): Draft {
  if (target.mode === "create") return { name: "", email: "", phone: "", website: "", defaultLeadDays: "0", categories: "", notes: "", isActive: true };
  const s = target.supplier;
  return { name: s.name, email: s.email ?? "", phone: s.phone ?? "", website: s.website ?? "", defaultLeadDays: String(s.defaultLeadDays ?? 0), categories: s.categories.join(", "), notes: s.notes ?? "", isActive: s.isActive };
}

export function StockSupplierEditor({ target, onClose, onSaved }: { target: StockEditorTarget | null; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft(target ? draftFor(target) : null);
    setError(null);
  }, [target]);

  if (!target || !draft) return null;
  const current = draft;
  const editing = target.mode === "edit" ? target.supplier : null;
  const patch = (next: Partial<Draft>) => setDraft((value) => (value ? { ...value, ...next } : value));

  async function save() {
    if (!current.name.trim()) {
      setError("Supplier name is required.");
      return;
    }
    const lead = Number(current.defaultLeadDays || 0);
    if (!Number.isInteger(lead) || lead < 0 || lead > 60) {
      setError("Lead days is a whole number from 0 to 60.");
      return;
    }
    const body = {
      ...(editing ?? {}),
      name: current.name.trim(),
      email: current.email.trim() || null,
      phone: current.phone.trim() || null,
      website: current.website.trim() || null,
      defaultLeadDays: lead,
      categories: current.categories.split(",").map((value) => value.trim()).filter(Boolean),
      notes: current.notes.trim() || null,
      ...(editing ? { isActive: current.isActive } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(editing ? `/api/admin/inventory/suppliers/${editing.id}` : "/api/admin/inventory/suppliers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? `Could not save (${response.status}).`);
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Your changes are kept; try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open onClose={saving ? () => undefined : onClose} eyebrow="Suppliers" title={editing ? `Edit stock supplier: ${editing.name}` : "Add stock supplier"} wide>
      <fieldset disabled={saving} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Name"><EInput value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></EField>
          <EField label="Email"><EInput type="email" value={draft.email} onChange={(event) => patch({ email: event.target.value })} /></EField>
          <EField label="Phone"><EInput value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} /></EField>
          <EField label="Website"><EInput value={draft.website} onChange={(event) => patch({ website: event.target.value })} /></EField>
          <EField label="Default lead days"><EInput type="number" min={0} max={60} value={draft.defaultLeadDays} onChange={(event) => patch({ defaultLeadDays: event.target.value })} /></EField>
          <EField label="Categories" hint="Comma separated"><EInput value={draft.categories} onChange={(event) => patch({ categories: event.target.value })} /></EField>
        </div>
        <EField label="Notes"><ETextarea rows={3} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} /></EField>
        {editing ? (
          <label className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            <input type="checkbox" checked={draft.isActive} onChange={(event) => patch({ isActive: event.target.checked })} />
            Active
          </label>
        ) : null}
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton variant="outline" onClick={onClose}>Cancel</EButton>
          <EButton variant="gold" onClick={() => void save()}>{saving ? "Saving…" : editing ? "Save changes" : "Add stock supplier"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
