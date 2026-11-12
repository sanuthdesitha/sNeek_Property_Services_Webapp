"use client";

/**
 * MARK AS SENT (NOT EMAILED) — restored from the pre-redesign editor, where the
 * status could be moved to SENT without the send route emailing anything (the
 * client already has the invoice: posted, handed over or sent from elsewhere).
 *
 * It is a plain PATCH { status: "SENT" } through the existing invoice action,
 * so the server still applies every rule for leaving draft (the "Before you
 * approve" checks, started-work review, empty-invoice and credit-limit checks),
 * snapshots the payment terms and first-sent day, locks editing, and audits the
 * move as "marked sent without email". Nothing is emailed.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import type { InvoiceRow } from "./invoice-model";
import { patchInvoice } from "./invoice-requests";

type DialogProps = { invoice: InvoiceRow; onClose: () => void; onDone: () => void };

export const MARK_SENT_DESCRIPTION =
  "No email is sent. Use this when the client already has this invoice (posted, handed over or sent from elsewhere). " +
  "The invoice becomes Sent: its payment terms and due date are fixed from today and it can no longer be edited. " +
  "The same checks as sending apply, and the change is recorded in the invoice history.";

export function MarkSentInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const result = await patchInvoice(invoice.id, { status: "SENT" });
      if (!result.ok) {
        // The refusal stays in the dialog so it is read before trying again.
        setError(result.body.error || "The invoice was not marked as sent.");
        return;
      }
      toast({ title: "Marked as sent", description: "No email was sent." });
      onDone();
      onClose();
    } catch {
      setError("Could not reach the server. The invoice was not changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EConfirmModal
      open
      onClose={() => !saving && onClose()}
      title={`Mark ${invoice.invoiceNumber} as sent without emailing?`}
      confirmLabel="Mark as sent"
      danger={false}
      loading={saving}
      onConfirm={confirm}
      description={
        <div className="space-y-3">
          <p>{MARK_SENT_DESCRIPTION}</p>
          {error ? (
            <p role="alert" className="text-[hsl(var(--e-danger))]">
              {error}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
