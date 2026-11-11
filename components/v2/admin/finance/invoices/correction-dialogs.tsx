"use client";

/**
 * The four corrections, each in its own confirmation so the difference is
 * read before clicking:
 *   Void      — finished with this invoice; its work goes back for a new one.
 *   Reverse   — same invoice back to draft, number and lines kept, nothing released.
 *   Reconcile — invoice already in Xero: record the correction made there (PIN + VOID).
 *   Delete    — remove an unexported draft entirely (PIN).
 * Requests, PIN and typed-phrase rules are the ones the old screen used. Void
 * and Reverse previously ran on one click; they now ask first.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EConfirmModal, EField, EInput, ETextarea, verifyAdminSecurity } from "@/components/v2/admin/estate-kit";
import type { InvoiceRow } from "./invoice-model";
import { deleteInvoiceRequest, patchInvoice, reconcileInvoiceRequest } from "./invoice-requests";

type DialogProps = { invoice: InvoiceRow; onClose: () => void; onDone: () => void };
type Credentials = { pin?: string; password?: string };

export function VoidInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [saving, setSaving] = useState(false);
  async function confirm() {
    setSaving(true);
    try {
      const result = await patchInvoice(invoice.id, { status: "VOID" });
      if (!result.ok) {
        toast({ title: "Failed", description: result.body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Invoice voided" });
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
      title={`Void ${invoice.invoiceNumber}?`}
      description="This invoice is finished with. Its work goes back in the pot so a new invoice can bill it. The number is not reused. To keep this invoice and fix its content, use Reverse to draft instead."
      confirmLabel="Void invoice"
      loading={saving}
      onConfirm={confirm}
    />
  );
}

/**
 * REVERSE — bring a sent or approved invoice back to editable: same invoice,
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
      description="Reopens this invoice as a draft, keeping its number and lines. Its work stays on it. Use Void instead if this invoice should be replaced by a new one."
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
    // The invoice DELETE route takes no security payload of its own, so the
    // PIN has to be verified here or the prompt is decoration — the modal only
    // checks the field is non-empty, and "1" would sail through it.
    try {
      await verifyAdminSecurity(credentials);
    } catch (err: unknown) {
      toast({ title: "Invoice not deleted", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      return;
    }
    setDeleting(true);
    try {
      const result = await deleteInvoiceRequest(invoice.id);
      if (!result.ok) {
        toast({ title: "Delete failed", description: result.body.error, variant: "destructive" });
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
      description="This permanently removes the invoice and all of its line items. Enter your PIN or password to continue."
      confirmLabel="Delete invoice"
      requireSecurity
      loading={deleting}
      onConfirm={confirm}
    />
  );
}

export function ReconcileInvoiceDialog({ invoice, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [correcting, setCorrecting] = useState(false);

  async function confirm(security?: Credentials) {
    if (correcting) return;
    setCorrecting(true);
    setError("");
    try {
      const result = await reconcileInvoiceRequest(invoice.id, { reason, reference, security });
      if (!result.ok) throw new Error(result.body.error || "Could not reconcile invoice.");
      toast({ title: "Reconciled invoice voided", description: "The invoice and Xero link remain in history." });
      onDone();
      onClose();
    } catch (cause) {
      // The draft reason and reference stay so the admin can correct and retry.
      setError(cause instanceof Error ? cause.message : "Could not reconcile invoice.");
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <EConfirmModal
      open
      onClose={() => !correcting && onClose()}
      title={`Reconcile ${invoice.invoiceNumber}`}
      requireSecurity
      confirmPhrase="VOID"
      confirmLabel="Record reconciled void"
      loading={correcting}
      onConfirm={confirm}
      description={
        <div className="space-y-3">
          <p>
            First void or correct this invoice in Xero. Confirming records your acknowledgement, then voids the local invoice
            and releases its work for replacement billing. The issued document, Xero link and audit history remain. This
            action does not contact Xero.
          </p>
          <fieldset disabled={correcting} className="space-y-3">
            <EField label="Reason (at least 10 characters)">
              <ETextarea aria-label="Reason (at least 10 characters)" value={reason} onChange={(event) => setReason(event.target.value)} />
            </EField>
            <EField label="Xero correction reference">
              <EInput aria-label="Xero correction reference" value={reference} onChange={(event) => setReference(event.target.value)} />
            </EField>
          </fieldset>
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
