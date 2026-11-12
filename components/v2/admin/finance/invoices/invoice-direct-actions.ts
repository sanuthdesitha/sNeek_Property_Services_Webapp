/**
 * The actions that run without a dialog (Approve, Push / Retry Xero), shared
 * by the list rows and the editor page so both send the same request and
 * report the outcome in the same words. A refusal carries the server's message.
 */
import { patchInvoice, pushInvoiceToXeroRequest } from "./invoice-requests";

export type DirectInvoiceAction = "approve" | "xero-push" | "xero-retry";

export type DirectActionOutcome = { ok: boolean; title: string; description?: string };

export function isDirectInvoiceAction(key: string): key is DirectInvoiceAction {
  return key === "approve" || key === "xero-push" || key === "xero-retry";
}

export async function runDirectInvoiceAction(key: DirectInvoiceAction, invoiceId: string): Promise<DirectActionOutcome> {
  if (key === "approve") {
    const result = await patchInvoice(invoiceId, { status: "APPROVED" });
    return result.ok ? { ok: true, title: "Invoice approved" } : { ok: false, title: "Failed", description: result.body.error };
  }
  const result = await pushInvoiceToXeroRequest(invoiceId);
  if (!result.ok) return { ok: false, title: "Xero export failed", description: result.body.error };
  return result.body.alreadyPushed
    ? { ok: true, title: "Already in Xero", description: "Nothing new was pushed." }
    : { ok: true, title: "Sent to Xero", description: "Created a draft invoice in Xero." };
}
