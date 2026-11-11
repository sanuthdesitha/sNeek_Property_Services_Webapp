"use client";

/**
 * Decline a continuation request with a reason (owner decision: required,
 * and the cleaner sees it). One component for Live ops and Command's work
 * queue, so the rule and the wording are identical in both places. The
 * server refuses a decline without a reason too; this dialog only collects
 * it, freezes while the request runs and keeps the text when it fails.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import type { QueueActionResult } from "@/components/v2/admin/command/queue-actions";

export type DeclineReasonDialogProps = {
  open: boolean;
  /** Who and where, e.g. "Jane C. · Coogee Terrace". */
  subject: string;
  onClose: () => void;
  /** Sends the decline with the reason; resolves to the server's answer. */
  onSubmit: (reason: string) => Promise<QueueActionResult>;
  /** Called after the server confirmed the decline. */
  onDeclined: () => void;
};

export const DECLINE_REASON_MAX = 2000;

export function DeclineReasonDialog({ open, subject, onClose, onSubmit, onDeclined }: DeclineReasonDialogProps) {
  const fieldId = React.useId();
  const hintId = React.useId();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);
  // A different request starts from an empty reason.
  React.useEffect(() => {
    setReason("");
    setError(null);
  }, [subject]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = reason.trim();
    if (!text) {
      setError("Give a reason. The cleaner sees it.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onSubmit(text);
    if (!mounted.current) return;
    setBusy(false);
    if (result.ok) {
      setReason("");
      onDeclined();
    } else setError(result.message);
  }

  return (
    <EActionDialog
      open={open}
      busy={busy}
      onClose={onClose}
      eyebrow="Continuation request"
      title="Decline with a reason"
      description={<>Declining <b className="font-[600] text-[hsl(var(--e-foreground))]">{subject}</b>. The job goes back to paused and the cleaner is notified with your reason.</>}
    >
      <form id={`${fieldId}-form`} onSubmit={(event) => void submit(event)} className="space-y-2">
        <label htmlFor={fieldId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Reason (required)</label>
        <ETextarea
          id={fieldId}
          data-autofocus
          rows={4}
          maxLength={DECLINE_REASON_MAX}
          value={reason}
          disabled={busy}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this being declined?"
        />
        <p id={hintId} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Sent to the cleaner in their decision notification.</p>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</EButton>
          <EButton type="submit" size="sm" variant="danger" disabled={busy}>{busy ? "Declining…" : "Decline request"}</EButton>
        </div>
      </form>
    </EActionDialog>
  );
}
