/**
 * The content-edit locks the client-invoice PATCH applies, as named predicates
 * and the exact refusal messages it returns. The PATCH action
 * (client-invoice-patch.ts) and the editor page both read them from here, so
 * the page can never present an invoice as editable when the server would
 * refuse the edit, nor state a different reason.
 *
 * Pure and free of server imports: safe for client components and tests.
 */

export const XERO_RESERVATION_REFUSAL =
  "Xero export is reserved or awaiting reconciliation. Retry the existing export before editing.";
export const XERO_ISSUED_REFUSAL =
  "This invoice is in Xero. Reconcile a correction there before altering the issued document.";
export const PAYMENT_EVIDENCE_REFUSAL =
  "This invoice has payment evidence. Use a reconciled correction; its payment history cannot be cleared.";

/** A durable Xero export reservation (also left behind by a failed push). */
export function isXeroExportPending(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).xeroExportState === "PENDING";
}

export type PaymentEvidenceFacts = {
  paidAt: Date | string | null;
  paidAmount: number | null;
};

/** Any recorded payment: a settled stamp or a positive amount received. */
export function hasPaymentEvidence(invoice: PaymentEvidenceFacts): boolean {
  return Boolean(invoice.paidAt) || Number(invoice.paidAmount ?? 0) > 0;
}

export type InvoiceEditLockKind =
  | "void"
  | "payment"
  | "xero-issued"
  | "xero-pending"
  | "issued"
  | "view-only";

export type InvoiceEditLock = { editable: true } | { editable: false; kind: InvoiceEditLockKind; reason: string };

export type InvoiceEditFacts = PaymentEvidenceFacts & {
  status: string;
  xeroInvoiceId: string | null;
  metadata: unknown;
};

/** Statuses whose content the screen offers to edit (the list's "edit" rule). */
export const EDITABLE_INVOICE_STATUSES: ReadonlySet<string> = new Set(["DRAFT", "APPROVED"]);

/**
 * Whether the editor offers in-place editing, and if not, why. The first four
 * reasons are the PATCH refusals themselves. "issued" is the screen's existing
 * rule (the list only offered editing on drafts and approved invoices; a sent
 * invoice is reversed to draft first). "view-only" is the operations-manager
 * feature level: middleware refuses their PATCH.
 */
export function invoiceEditLock(invoice: InvoiceEditFacts, canManage: boolean): InvoiceEditLock {
  if (invoice.status === "VOID") {
    return { editable: false, kind: "void", reason: "This invoice is void. Generate a replacement rather than editing it." };
  }
  if (hasPaymentEvidence(invoice)) return { editable: false, kind: "payment", reason: PAYMENT_EVIDENCE_REFUSAL };
  if (invoice.xeroInvoiceId) return { editable: false, kind: "xero-issued", reason: XERO_ISSUED_REFUSAL };
  if (isXeroExportPending(invoice.metadata)) {
    return { editable: false, kind: "xero-pending", reason: XERO_RESERVATION_REFUSAL };
  }
  if (!EDITABLE_INVOICE_STATUSES.has(invoice.status)) {
    return {
      editable: false,
      kind: "issued",
      reason: "This invoice has been sent to the client. To change it, use Reverse to draft under More actions.",
    };
  }
  if (!canManage) {
    return { editable: false, kind: "view-only", reason: "Your access to invoices is view only." };
  }
  return { editable: true };
}

/** Lines tied to a reviewed shopping allocation: amounts and grouping are locked. */
export function isShoppingLockedLine(line: { shoppingClientChargeId: string | null; shoppingRunId: string | null }): boolean {
  return Boolean(line.shoppingClientChargeId || line.shoppingRunId);
}
