"use client";

/**
 * The required status-change note (the existing rule: a status change is
 * refused without one). Used for a single case and for bulk status/close.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import { CASE_STATUS_LABELS } from "@/lib/cases/status";
import type { CaseStatus } from "./case-types";

export type StatusDialogRequest = {
  /** What the change applies to, e.g. a case title or "3 cases". */
  subject: string;
  nextStatus: CaseStatus;
};

type Props = {
  request: StatusDialogRequest | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (note: string) => void;
};

export function CaseStatusDialog({ request, saving, onCancel, onConfirm }: Props) {
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    setNote("");
    setError("");
  }, [request]);

  function confirm() {
    if (!note.trim()) {
      setError("Add a note explaining the status change.");
      return;
    }
    onConfirm(note.trim());
  }

  return (
    <EModal open={Boolean(request)} onClose={onCancel} title="Update case status" eyebrow="Confirm change">
      <div className="space-y-4">
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.875rem]">
          <p className="font-[550]">{request?.subject}</p>
          <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">Status will change to {request ? CASE_STATUS_LABELS[request.nextStatus] : ""}.</p>
        </div>
        <EField label="Reason / note" hint="Required. Kept as an internal note on the case.">
          <ETextarea rows={4} value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} placeholder="Explain why this case is moving to the new status." />
        </EField>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <EButton variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</EButton>
          <EButton size="sm" onClick={confirm} disabled={saving}>{saving ? "Saving…" : "Save status change"}</EButton>
        </div>
      </div>
    </EModal>
  );
}
