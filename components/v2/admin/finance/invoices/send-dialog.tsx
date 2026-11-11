"use client";

/**
 * Send (or re-send) one invoice: review the exact PDF, choose the recipient,
 * confirm. Same request and the same "I've reviewed" gate as before. Re-send is
 * offered for SENT and PART_PAID invoices; the server keeps a part-paid
 * invoice's status and only restamps when it was sent.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESwitch } from "@/components/v2/admin/estate-kit";
import type { InvoiceRow } from "./invoice-model";
import { pdfHref, sendInvoiceRequest } from "./invoice-requests";

export function SendInvoiceDialog({
  invoice,
  resend,
  initialTo,
  onClose,
  onDone,
}: {
  invoice: InvoiceRow;
  resend: boolean;
  /** Recipient typed on the editor page's Send card; defaults to the client email. */
  initialTo?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(initialTo ?? invoice.client.email ?? "");
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);

  async function submit() {
    setSending(true);
    try {
      const result = await sendInvoiceRequest(invoice.id, email);
      if (!result.ok) {
        toast({ title: "Send failed", description: result.body.error, variant: "destructive" });
        return;
      }
      toast({ title: resend ? "Invoice re-sent" : "Invoice sent" });
      onDone();
      onClose();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <EModal
      open
      onClose={() => {
        if (!sending) onClose();
      }}
      eyebrow="Commercial"
      title={`${resend ? "Re-send" : "Send"} ${invoice.invoiceNumber}`}
      wide
    >
      <div className="space-y-4">
        <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
          {resend
            ? "Review the exact PDF the client will receive. Re-sending emails it again now. A part-paid invoice keeps its part-paid status."
            : "Review the exact PDF the client will receive. Sending emails them immediately and marks the invoice as Sent — this can't be undone."}
        </p>
        <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          <iframe title="Invoice preview" src={pdfHref(invoice.id)} className="h-[46vh] w-full" />
        </div>
        <fieldset disabled={sending} className="space-y-4">
          <EField label="Send to email" hint="Leave blank to use the client's delivery profile.">
            <EInput
              type="email"
              aria-label="Send to email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={invoice.client.email ?? undefined}
            />
          </EField>
          <ESwitch
            checked={reviewed}
            onCheckedChange={setReviewed}
            label="I've reviewed the invoice above and confirm it's correct to send."
          />
        </fieldset>
        <EButton className="w-full" variant="gold" onClick={submit} disabled={sending || !reviewed}>
          {sending ? "Sending…" : resend ? "Re-send invoice to client" : "Send invoice to client"}
        </EButton>
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          A successful send means the email provider accepted the message. It does not prove delivery.
        </p>
      </div>
    </EModal>
  );
}
