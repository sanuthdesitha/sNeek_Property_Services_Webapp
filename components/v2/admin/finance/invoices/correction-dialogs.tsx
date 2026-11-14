"use client";

/**
 * The four corrections, each in its own confirmation so the difference is
 * read before clicking:
 *   Void      — finished with this invoice; its work goes back for a new one.
 *   Reverse   — same invoice back to draft, number and lines kept, nothing released.
 *   Reconcile — invoice already in Xero: record the correction made there.
 *   Delete    — remove an unexported draft entirely (PIN, verified by the server).
 * Tiers (board "Confirmations and deletes", 2026-11-14): Reverse is ordinary
 * (A); Void, Reconcile and Delete are sensitive (C, own PIN). Void and
 * Reconcile keep a required reason as a quick pick, with no minimum length.
 * Nobody types VOID. The reconcile route still requires the Xero correction
 * reference, so it stays visible and required; the optional note goes under
 * "Add details".
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EConfirmModal, EField, EInput } from "@/components/v2/admin/estate-kit";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import type { InvoiceRow } from "./invoice-model";
import {
  deleteInvoiceRequest,
  patchInvoice,
  reconcileInvoiceRequest,
  securityRefusalMessage,
  voidInvoiceRequest,
  type SensitiveSecurity,
} from "./invoice-requests";

type DialogProps = { invoice: InvoiceRow; onClose: () => void; onDone: () => void };
type Credentials = SensitiveSecurity;

/** Void: a sensitive action since 2026-11-13, confirmed with the person's own PIN and a quick-pick reason. */
export function VoidInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const creditNote = invoice.kind === "CREDIT_NOTE";
  async function confirm(credentials?: SensitiveSecurity, reason?: string) {
    setSaving(true);
    setError("");
    try {
      const result = await voidInvoiceRequest(invoice.id, credentials, reason);
      if (!result.ok) {
        // The dialog stays open with the reason picked; the PIN is cleared.
        setError(`It was not voided. ${securityRefusalMessage(result.body.error, "Void failed.")}`);
        return;
      }
      toast({ title: creditNote ? "Credit note voided" : "Invoice voided" });
      onDone();
      onClose();
    } catch {
      setError("It was not voided. Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <EConfirmModal
      open
      onClose={() => !saving && onClose()}
      title={`Void ${invoice.invoiceNumber}?`}
      requireSecurity
      reason={{ label: "Reason", choices: creditNote ? REASON_CHOICES.creditNoteVoid : REASON_CHOICES.invoiceVoid }}
      error={error || undefined}
      description={
        creditNote
          ? "This credit note no longer reduces what is owed on the invoice it credits. The number is not reused."
          : invoice.status === "APPROVED"
          ? "This invoice is finished with. Its work goes back in the pot so a new invoice can bill it. The number is not reused. To keep this invoice and fix its content, use Reverse to draft instead."
          : "This invoice is finished with. Its work goes back in the pot so a new invoice can bill it. The number is not reused. To correct an invoice the client already has, issue a credit note instead."
      }
      confirmLabel={creditNote ? "Void credit note" : "Void invoice"}
      loading={saving}
      onConfirm={confirm}
    />
  );
}

/**
 * REVERSE — bring an approved (never sent) invoice back to editable: same invoice,
 * same number, same lines, and (unlike a void) the work on it is NOT released,
 * because this invoice is still the one that will bill it.
 */
export function ReverseInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [saving, setSaving] = useState(false);
  async function confirm() {
    setSaving(true);
    try {
      const result = await patchInvoice(invoice.id, { reverse: {} });
      if (!result.ok) {
        toast({ title: "Could not reverse this invoice", description: result.body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Invoice reversed", description: "It is a draft again. Its number and lines are unchanged." });
      onDone();
      onClose();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }
  return (
    <EConfirmModal
      open
      onClose={() => !saving && onClose()}
      title={`Reverse ${invoice.invoiceNumber} to draft?`}
      description="It opens again as a draft with the same number and lines; its work stays on it."
      confirmLabel="Reverse to draft"
      danger={false}
      loading={saving}
      onConfirm={confirm}
    />
  );
}

export function DeleteInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [deleting, setDeleting] = useState(false);
  async function confirm(credentials?: Credentials) {
    // The DELETE route verifies the PIN or password itself; nothing is
    // deleted unless the server accepts it.
    setDeleting(true);
    try {
      const result = await deleteInvoiceRequest(invoice.id, credentials);
      if (!result.ok) {
        toast({ title: "Invoice not deleted", description: securityRefusalMessage(result.body.error, "Delete failed."), variant: "destructive" });
        return;
      }
      toast({ title: "Invoice deleted" });
      onDone();
      onClose();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }
  return (
    <EConfirmModal
      open
      onClose={() => !deleting && onClose()}
      title={`Delete ${invoice.invoiceNumber}?`}
      description="The draft and all of its lines are removed; its work can go on another invoice. This cannot be undone."
      confirmLabel="Delete invoice"
      requireSecurity
      loading={deleting}
      onConfirm={confirm}
    />
  );
}

export function ReconcileInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [correcting, setCorrecting] = useState(false);

  async function confirm(security?: Credentials, reason?: string) {
    if (correcting || !reason) return;
    setCorrecting(true);
    setError("");
    try {
      const result = await reconcileInvoiceRequest(invoice.id, { reason, reference: reference.trim(), security });
      if (!result.ok) throw new Error(securityRefusalMessage(result.body.error, "Could not reconcile invoice."));
      toast({ title: "Reconciled invoice voided", description: "The invoice and Xero link remain in history." });
      onDone();
      onClose();
    } catch (cause) {
      // The pick, the reference and the note stay so the admin can correct and retry; the PIN is cleared.
      setError(`It was not recorded. ${cause instanceof Error ? cause.message : "Could not reconcile invoice."}`);
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <EConfirmModal
      open
      onClose={() => !correcting && onClose()}
      title={`Record the Xero void for ${invoice.invoiceNumber}?`}
      requireSecurity
      confirmLabel="Record void"
      loading={correcting}
      onConfirm={confirm}
      error={error || undefined}
      confirmDisabled={reference.trim().length < 3}
      reason={{ label: "What happened in Xero?", choices: REASON_CHOICES.xeroReconcile, detail: note }}
      details={{
        label: "Add details: note",
        content: (
          <EField label="Note, optional">
            <EInput value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Anything else" />
          </EField>
        ),
      }}
      description={
        <p>
          Void or correct it in Xero first; we do not contact Xero. This voids {invoice.invoiceNumber} here and its work can go on a new
          invoice. The sent document and Xero link stay in its history.
        </p>
      }
    >
      <EField label="Xero reference, required">
        <EInput value={reference} maxLength={500} disabled={correcting} onChange={(event) => setReference(event.target.value)} placeholder="e.g. CN-00412" />
      </EField>
    </EConfirmModal>
  );
}
