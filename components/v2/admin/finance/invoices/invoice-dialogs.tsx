"use client";

/**
 * Which dialog is open, as one value, and the switch that renders it. Each
 * dialog keeps its own form state and is keyed by invoice, so opening another
 * invoice never shows the previous one's draft.
 */
import type { InvoiceFormContext, InvoiceRow } from "./invoice-model";
import { SendInvoiceDialog } from "./send-dialog";
import { MarkPaidDialog, ReceiptDialog, RecordPaymentDialog } from "./payment-dialogs";
import { DeleteInvoiceDialog, ReconcileInvoiceDialog, ReverseInvoiceDialog, VoidInvoiceDialog } from "./correction-dialogs";
import { GenerateInvoiceDialog } from "./generate-invoice-dialog";
import { InvoiceEditorDialog } from "./invoice-editor";

export type InvoiceDialog =
  | null
  | { kind: "generate" }
  | { kind: "send"; invoice: InvoiceRow; resend: boolean }
  | {
      kind: "edit" | "record-payment" | "mark-paid" | "receipt" | "void" | "reverse" | "reconcile" | "delete";
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
  const key = `${dialog.kind}:${dialog.invoice.id}`;
  const props = { invoice: dialog.invoice, onClose, onDone };
  switch (dialog.kind) {
    case "send":
      return <SendInvoiceDialog key={key} {...props} resend={dialog.resend} />;
    case "edit":
      return (
        <InvoiceEditorDialog
          key={key}
          invoice={dialog.invoice}
          properties={context?.properties ?? []}
          onClose={onClose}
          onChanged={onDone}
        />
      );
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
