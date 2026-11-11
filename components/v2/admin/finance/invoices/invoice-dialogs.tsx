"use client";

/**
 * Which dialog is open, as one value, and the switch that renders it. Each
 * dialog keeps its own form state and is keyed by invoice, so opening another
 * invoice never shows the previous one's draft. The line editor is a page
 * (/v2/admin/finance/invoices/[id]), not a dialog.
 */
import type { InvoiceFormContext, InvoiceRow } from "./invoice-model";
import { SendInvoiceDialog } from "./send-dialog";
import { MarkPaidDialog, ReceiptDialog, RecordPaymentDialog } from "./payment-dialogs";
import { DeleteInvoiceDialog, ReconcileInvoiceDialog, ReverseInvoiceDialog, VoidInvoiceDialog } from "./correction-dialogs";
import { GenerateInvoiceDialog } from "./generate-invoice-dialog";
import { BlankInvoiceDialog, IssueCreditNoteDialog, NewCreditNoteDialog } from "./create-dialogs";

export type InvoiceDialog =
  | null
  | { kind: "generate" }
  | { kind: "blank" }
  | { kind: "new-credit-note" }
  | { kind: "credit-note"; invoice: InvoiceRow }
  | { kind: "send"; invoice: InvoiceRow; resend: boolean; to?: string }
  | {
      kind: "record-payment" | "mark-paid" | "receipt" | "void" | "reverse" | "reconcile" | "delete";
      invoice: InvoiceRow;
    };

export function InvoiceDialogs({
  dialog,
  context,
  onClose,
  onDone,
}: {
  dialog: InvoiceDialog;
  context: InvoiceFormContext | null;
  onClose: () => void;
  onDone: () => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === "generate") {
    return context ? <GenerateInvoiceDialog context={context} onClose={onClose} onDone={onDone} /> : null;
  }
  if (dialog.kind === "blank") {
    return context ? <BlankInvoiceDialog clients={context.clients} onClose={onClose} /> : null;
  }
  if (dialog.kind === "new-credit-note") return <NewCreditNoteDialog onClose={onClose} />;
  if (dialog.kind === "credit-note") {
    return <IssueCreditNoteDialog key={`credit-note:${dialog.invoice.id}`} invoice={dialog.invoice} onClose={onClose} />;
  }
  const key = `${dialog.kind}:${dialog.invoice.id}`;
  const props = { invoice: dialog.invoice, onClose, onDone };
  switch (dialog.kind) {
    case "send":
      return <SendInvoiceDialog key={key} {...props} resend={dialog.resend} initialTo={dialog.to} />;
    case "record-payment":
      return <RecordPaymentDialog key={key} {...props} />;
    case "mark-paid":
      return <MarkPaidDialog key={key} {...props} />;
    case "receipt":
      return <ReceiptDialog key={key} invoice={dialog.invoice} onClose={onClose} />;
    case "void":
      return <VoidInvoiceDialog key={key} {...props} />;
    case "reverse":
      return <ReverseInvoiceDialog key={key} {...props} />;
    case "reconcile":
      return <ReconcileInvoiceDialog key={key} {...props} />;
    case "delete":
      return <DeleteInvoiceDialog key={key} {...props} />;
    default:
      return null;
  }
}
