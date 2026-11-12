"use client";

/**
 * "Add extra payment" from the person page's More menu: the Cleaners roster's
 * dialog, same endpoint and rules (POST /api/admin/pay-adjustments,
 * auto-approved, on the cleaner's next invoice). Fields freeze while saving;
 * a failed save keeps what was typed.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ETextarea } from "@/components/v2/admin/estate-kit";

type Draft = { amount: string; title: string; note: string; jobNumber: string };
const EMPTY: Draft = { amount: "", title: "", note: "", jobNumber: "" };

export function AddPaymentDialog({ open, cleanerId, name, onClose, onSaved }: { open: boolean; cleanerId: string; name: string; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(EMPTY);
    setError(null);
  }, [cleanerId]);

  async function save() {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) return setError("Enter a valid amount.");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pay-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerId, amount, title: draft.title.trim() || "Extra payment", note: draft.note.trim() || undefined, jobNumber: draft.jobNumber.trim() || undefined, autoApprove: true }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Could not add the payment (${res.status}).`);
      setDraft(EMPTY);
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add the payment.");
    } finally {
      setSaving(false);
    }
  }

  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  return (
    <EModal open={open} onClose={() => (saving ? undefined : onClose())} eyebrow="Pay" title={`Extra payment — ${name}`}>
      <div className="space-y-3">
        <EField label="Amount ($)"><EInput inputMode="decimal" value={draft.amount} disabled={saving} onChange={set("amount")} /></EField>
        <EField label="Link to job # (optional)"><EInput value={draft.jobNumber} disabled={saving} onChange={set("jobNumber")} /></EField>
        <EField label="Title"><EInput value={draft.title} disabled={saving} onChange={set("title")} placeholder="Extra payment" /></EField>
        <EField label="Note (optional)"><ETextarea value={draft.note} disabled={saving} onChange={set("note")} rows={3} /></EField>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Approved straight away; it appears on the cleaner&apos;s next invoice.</p>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton size="sm" variant="outline" disabled={saving} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" variant="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Add payment"}</EButton>
        </div>
      </div>
    </EModal>
  );
}
