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
  | "review-unreadable"
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
  /** INVOICE when absent (rows read before credit notes existed). */
  kind?: string | null;
};

/** Statuses whose content may be edited, on screen and by the PATCH. */
export const EDITABLE_INVOICE_STATUSES: ReadonlySet<string> = new Set(["DRAFT", "APPROVED"]);

export const ISSUED_INVOICE_REFUSAL =
  "This invoice has been sent to the client, so its content is locked. Corrections go through a credit note: use Issue credit note under More actions.";
export const ISSUED_CREDIT_NOTE_REFUSAL =
  "This credit note has been sent to the client, so its content is locked.";
export const VOID_INVOICE_REFUSAL = "This invoice is void. Generate a replacement rather than editing it.";

export const STARTED_WORK_UNREADABLE_REFUSAL =
  "The started-work review data on this invoice could not be read. It is shown read only and cannot be approved; office reconciliation is required.";

/**
 * Whether a started-work snapshot has the shape the review needs. The one
 * validity rule: readStartedWorkReview throws on exactly what this rejects.
 */
export function isValidStartedWorkSnapshot(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as { version?: unknown; jobs?: unknown; periodStart?: unknown; periodEnd?: unknown };
  const day = (raw: unknown) => (typeof raw === "string" || raw instanceof Date) && Number.isFinite(new Date(raw).getTime());
  return snapshot.version === 1 && Array.isArray(snapshot.jobs) && day(snapshot.periodStart) && day(snapshot.periodEnd);
}

/** True when the invoice carries a started-work snapshot that cannot be read. */
export function startedWorkReviewUnreadable(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const value = (metadata as Record<string, unknown>).startedWorkReview;
  return Boolean(value) && !isValidStartedWorkSnapshot(value);
}

export type InvoiceContentLock = { editable: true } | { editable: false; kind: InvoiceEditLockKind; reason: string };

/**
 * Whether the invoice's CONTENT (lines, GST, discount, client reference, note
 * to client, order) may change at all, whoever asks. The PATCH refuses content
 * edits with exactly this reason, and the editor shows the same reason, so the
 * screen and the server can never disagree. Status moves and payments are not
 * content: they follow the transition graph.
 */
export function invoiceContentLock(invoice: InvoiceEditFacts): InvoiceContentLock {
  if (invoice.status === "VOID") return { editable: false, kind: "void", reason: VOID_INVOICE_REFUSAL };
  // Unknown is never OK: an unreadable review snapshot keeps the invoice read only.
  if (startedWorkReviewUnreadable(invoice.metadata)) {
    return { editable: false, kind: "review-unreadable", reason: STARTED_WORK_UNREADABLE_REFUSAL };
  }
  if (hasPaymentEvidence(invoice)) return { editable: false, kind: "payment", reason: PAYMENT_EVIDENCE_REFUSAL };
  if (invoice.xeroInvoiceId) return { editable: false, kind: "xero-issued", reason: XERO_ISSUED_REFUSAL };
  if (isXeroExportPending(invoice.metadata)) {
    return { editable: false, kind: "xero-pending", reason: XERO_RESERVATION_REFUSAL };
  }
  if (!EDITABLE_INVOICE_STATUSES.has(invoice.status)) {
    const reason = invoice.kind === "CREDIT_NOTE" ? ISSUED_CREDIT_NOTE_REFUSAL : ISSUED_INVOICE_REFUSAL;
    return { editable: false, kind: "issued", reason };
  }
  return { editable: true };
}

/**
 * Whether the editor offers in-place editing, and if not, why: the content
 * lock above, then the operations-manager feature level ("view-only":
 * middleware refuses their PATCH).
 */
export function invoiceEditLock(invoice: InvoiceEditFacts, canManage: boolean): InvoiceEditLock {
  const content = invoiceContentLock(invoice);
  if (!content.editable) return content;
  if (!canManage) {
    return { editable: false, kind: "view-only", reason: "Your access to invoices is view only." };
  }
  return { editable: true };
}

export const EMPTY_INVOICE_REFUSAL = "This invoice has no lines. Add at least one line before approving or sending it.";

/** A blank draft with no lines cannot be approved, sent, paid or pushed. */
export function emptyInvoiceRefusal(invoice: { lines: readonly unknown[] }): string | null {
  return invoice.lines.length === 0 ? EMPTY_INVOICE_REFUSAL : null;
}

/** Lines tied to a reviewed shopping allocation: amounts and grouping are locked. */
export function isShoppingLockedLine(line: { shoppingClientChargeId: string | null; shoppingRunId: string | null }): boolean {
  return Boolean(line.shoppingClientChargeId || line.shoppingRunId);
}
