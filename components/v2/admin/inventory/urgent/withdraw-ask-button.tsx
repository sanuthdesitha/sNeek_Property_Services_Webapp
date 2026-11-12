"use client";

/** Withdraw an unanswered "buy" ask, with a reason (kept in the need's history). */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EModal, ETextarea } from "@/components/v2/admin/estate-kit";

export function WithdrawAskButton({ askId, cleanerName, onDone }: { askId: string; cleanerName: string; onDone: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/inventory/urgent-stock/asks/${encodeURIComponent(askId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", reason }) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Not withdrawn (${response.status}).`);
      setOpen(false);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not withdrawn.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <EButton size="sm" variant="outline" onClick={() => setOpen(true)}>Withdraw ask</EButton>
      <EModal open={open} onClose={() => (saving ? undefined : setOpen(false))} eyebrow="Urgent needs" title={`Withdraw the ask to ${cleanerName}`}>
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">The cleaner can no longer accept it. The notice already sent stays in their inbox.</p>
            <EField label="Reason"><ETextarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></EField>
            {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</EButton>
              <EButton type="submit" size="sm" disabled={!reason.trim()}>{saving ? "Withdrawing…" : "Withdraw"}</EButton>
            </div>
          </fieldset>
        </form>
      </EModal>
    </>
  );
}
