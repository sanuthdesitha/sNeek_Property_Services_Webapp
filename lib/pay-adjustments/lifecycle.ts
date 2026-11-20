/**
 * PAY REQUEST LIFECYCLE RULES (pure — no DB, no I/O; 2026-11-18).
 *
 * One place answers the questions every surface and every route asks about a
 * single `CleanerPayAdjustment` once it exists:
 *
 *   - Where was it settled, if anywhere?        → `payRequestSettlement`
 *   - May the office still edit it, and if not,
 *     why (in words)?                           → `payRequestEditLock`
 *   - May the client side (bill / amount) change? → `clientBillingLock`
 *   - May it be marked paid / un-marked?        → `markPaidRefusal`, `undoPaidRefusal`
 *   - May it be linked to this job?             → `jobLinkRefusal`
 *   - Is it billed to the client by default?    → `defaultBillToClient`
 *   - Has the client agreed to pay it?          → `clientConsentState`
 *
 * The routes call these; the screens call the same functions to decide what to
 * offer, so a button is never shown that the server will refuse for a reason
 * the screen did not explain.
 *
 * Money arithmetic is NOT done here — amounts come from stored figures through
 * `adjustmentSignedAmount` (lib/finance/pay-adjustments.ts).
 */

/** The markers a row carries. Dates may arrive as Date or ISO strings. */
export interface PayRequestMarkers {
  status: string;
  includedInPayrollRunId?: string | null;
  includedInCleanerInvoiceId?: string | null;
  includedInCleanerInvoiceAt?: Date | string | null;
  paidOutsideAt?: Date | string | null;
  paidOutsideDate?: Date | string | null;
  paidOutsideMethod?: string | null;
  paidOutsideReference?: string | null;
}

export type PayRequestSettlement =
  | { kind: "PAYROLL"; id: string }
  | { kind: "CLEANER_INVOICE"; id: string; at: string | null }
  | {
      kind: "PAID_OUTSIDE";
      at: string;
      /** Calendar date (YYYY-MM-DD) the money left, when recorded. */
      date: string | null;
      method: string | null;
      reference: string | null;
    };

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A calendar date kept as the stored day (never shifted by a time zone). */
function calendarDate(value: Date | string | null | undefined): string | null {
  const stamp = iso(value);
  return stamp ? stamp.slice(0, 10) : null;
}

/**
 * Which of the three settlement markers is set. Payroll first, then the
 * cleaner invoice, then paid outside — only one can be set at a time because
 * every claim is guarded on all three being empty.
 */
export function payRequestSettlement(row: PayRequestMarkers): PayRequestSettlement | null {
  if (row.includedInPayrollRunId) return { kind: "PAYROLL", id: row.includedInPayrollRunId };
  if (row.includedInCleanerInvoiceId) {
    return { kind: "CLEANER_INVOICE", id: row.includedInCleanerInvoiceId, at: iso(row.includedInCleanerInvoiceAt) };
  }
  const paidAt = iso(row.paidOutsideAt);
  if (paidAt) {
    return {
      kind: "PAID_OUTSIDE",
      at: paidAt,
      date: calendarDate(row.paidOutsideDate),
      method: row.paidOutsideMethod ?? null,
      reference: row.paidOutsideReference ?? null,
    };
  }
  return null;
}

/** Labels a caller can supply so the sentence names documents, not ids. */
export interface SettlementLabels {
  cleanerInvoiceNumber?: string | null;
  cleanerInvoiceStatus?: string | null;
  payrollRunLabel?: string | null;
}

/** The settlement in words, for both the office and the payee. */
export function settlementSentence(settlement: PayRequestSettlement | null, labels: SettlementLabels = {}): string {
  if (!settlement) return "Not paid yet.";
  if (settlement.kind === "PAYROLL") {
    return `Paid in pay run ${labels.payrollRunLabel?.trim() || settlement.id}.`;
  }
  if (settlement.kind === "CLEANER_INVOICE") {
    const number = labels.cleanerInvoiceNumber?.trim();
    return number ? `Billed on cleaner invoice ${number}.` : "Billed on a cleaner invoice.";
  }
  const parts = ["Marked paid outside the system"];
  if (settlement.date) parts.push(`on ${settlement.date}`);
  if (settlement.method) parts.push(`by ${settlement.method.toLowerCase().replace(/_/g, " ")}`);
  const reference = settlement.reference ? ` (reference ${settlement.reference})` : "";
  return `${parts.join(" ")}${reference}.`;
}

/** The client invoice line an extra sits on, as the lock rules need it. */
export interface ClientLineFacts {
  invoiceNumber: string;
  invoiceStatus: string;
  /** invoiceContentLock(...).editable — no payment, not in Xero, not issued. */
  contentEditable: boolean;
}

/** True only for a DRAFT whose content may still change. */
export function isClientLineOnDraft(line: ClientLineFacts | null | undefined): boolean {
  return Boolean(line && line.invoiceStatus === "DRAFT" && line.contentEditable);
}

export type LockResult = { editable: true } | { editable: false; reason: string };

/**
 * May the office edit this request's PAY side (amounts, type, hours, rate,
 * category, job link)? Fully editable while PENDING; after approval only while
 * no settlement marker is set. A request settled by any rail is read only —
 * raise a correcting adjustment instead.
 */
export function payRequestEditLock(row: PayRequestMarkers, labels: SettlementLabels = {}): LockResult {
  const settlement = payRequestSettlement(row);
  if (!settlement) return { editable: true };
  if (settlement.kind === "PAYROLL") {
    return { editable: false, reason: `Read only: ${settlementSentence(settlement, labels)} Raise a correcting adjustment instead.` };
  }
  if (settlement.kind === "CLEANER_INVOICE") {
    const status = labels.cleanerInvoiceStatus ? ` (${labels.cleanerInvoiceStatus.toLowerCase().replace(/_/g, " ")})` : "";
    return {
      editable: false,
      reason: `Read only: ${settlementSentence(settlement, labels).replace(/\.$/, "")}${status}. Raise a correcting adjustment instead.`,
    };
  }
  return { editable: false, reason: `Read only: ${settlementSentence(settlement, labels)} Undo "marked paid" first to change it.` };
}

/**
 * May the CLIENT side (bill to client, client amount, client wording) change?
 * Only while the extra is not on a client invoice, or is on a draft.
 */
export function clientBillingLock(line: ClientLineFacts | null | undefined): LockResult {
  if (!line) return { editable: true };
  if (isClientLineOnDraft(line)) return { editable: true };
  return {
    editable: false,
    reason: `The client billing is fixed: it is on client invoice ${line.invoiceNumber}, which is ${line.invoiceStatus.toLowerCase().replace(/_/g, " ")} or no longer editable. Raise a credit note or a new charge instead.`,
  };
}

/** Approved amount went down after approval: needs a reason the payee can read. */
export function isReductionAfterApproval(input: {
  previousStatus: string;
  previousApprovedAmount: number | null | undefined;
  nextStatus: string;
  nextApprovedAmount: number | null | undefined;
}): boolean {
  if (input.previousStatus !== "APPROVED") return false;
  const before = Number(input.previousApprovedAmount);
  if (!Number.isFinite(before)) return false;
  // Declining or reopening an approved request takes the whole amount away.
  if (input.nextStatus !== "APPROVED") return before > 0;
  const after = Number(input.nextApprovedAmount);
  if (!Number.isFinite(after)) return false;
  return Math.round(after * 100) < Math.round(before * 100);
}

export interface MarkPaidFacts extends PayRequestMarkers {
  approvedAmount?: number | null;
}

/** Null when the request may be marked paid outside the system. */
export function markPaidRefusal(row: MarkPaidFacts, labels: SettlementLabels = {}): string | null {
  if (row.status !== "APPROVED") return "Only an approved request can be marked paid. Approve it first.";
  const amount = row.approvedAmount == null ? Number.NaN : Number(row.approvedAmount);
  if (!Number.isFinite(amount)) return "This request has no approved amount, so there is nothing to mark paid.";
  if (amount <= 0) return "A deduction is recovered through pay, not paid out, so it cannot be marked paid.";
  const settlement = payRequestSettlement(row);
  if (!settlement) return null;
  if (settlement.kind === "PAID_OUTSIDE") return "This request is already marked paid.";
  return `Not marked paid: ${settlementSentence(settlement, labels)} It is already settled there.`;
}

/** Null when "marked paid" may be undone. */
export function undoPaidRefusal(row: PayRequestMarkers): string | null {
  if (!row.paidOutsideAt) return "This request is not marked paid.";
  // Every claim is guarded on all three markers, so nothing else can depend on
  // a paid-outside row; this is belt and braces against a corrupted row.
  if (row.includedInPayrollRunId || row.includedInCleanerInvoiceId) {
    return "This request is also stamped by a pay run or cleaner invoice. Ask an administrator to review it.";
  }
  return null;
}

export interface LinkCandidateJob {
  id: string;
  propertyId: string;
  status: string;
  assignments: ReadonlyArray<{ userId: string; removedAt?: Date | string | null }>;
}

/**
 * Null when this request may be linked to this job: the payee must hold an
 * active assignment on it, and a request already tied to a property may only
 * move to a job at that same property. Unsettled requests only.
 */
export function jobLinkRefusal(input: {
  request: PayRequestMarkers & { cleanerId: string; propertyId?: string | null };
  job: LinkCandidateJob | null;
}): string | null {
  const lock = payRequestEditLock(input.request);
  if (!lock.editable) return lock.reason;
  if (!input.job) return "That job was not found.";
  if (input.job.status === "CANCELLED") return "That job was cancelled. Link the request to the job the work was done on.";
  // The same rule a cleaner meets when raising a request from a job.
  if (input.job.status === "UNASSIGNED" || input.job.status === "OFFERED") {
    return "That job has not been accepted by its cleaner yet. A request can only be linked to a job its cleaner worked.";
  }
  const assigned = input.job.assignments.some((row) => row.userId === input.request.cleanerId && !row.removedAt);
  if (!assigned) return "This cleaner is not assigned to that job. A request can only be linked to a job its cleaner worked.";
  if (input.request.propertyId && input.request.propertyId !== input.job.propertyId) {
    return "That job is at a different property from the request. Pick a job at the same property.";
  }
  return null;
}

/**
 * The bill-to-client default the approval dialog starts from (owner default
 * pending confirmation, 2026-11-18): ON for a job-linked SERVICE request when
 * the organisation setting is on and the job's property has a client; OFF for
 * PARKING / REIMBURSEMENT and for unlinked requests.
 */
export function defaultBillToClient(input: {
  settingOn: boolean;
  jobId: string | null | undefined;
  category: string | null | undefined;
  propertyHasClient: boolean;
}): boolean {
  if (!input.settingOn) return false;
  if (!input.jobId) return false;
  if ((input.category ?? "SERVICE").toUpperCase() !== "SERVICE") return false;
  return input.propertyHasClient;
}

export type ClientConsentState = "NOT_ASKED" | "AWAITING" | "APPROVED" | "DECLINED";

/** What the client said, from the latest client approval sent for this request. */
export function clientConsentState(approval: { status: string } | null | undefined): ClientConsentState {
  if (!approval) return "NOT_ASKED";
  if (approval.status === "APPROVED") return "APPROVED";
  if (approval.status === "PENDING" || approval.status === "COUNTERED") return "AWAITING";
  return "DECLINED";
}

/**
 * Null when the extra may be put on a client invoice now. An extra sent to the
 * client for their decision is billed only once they approved it.
 */
export function clientChargeRefusal(input: {
  status: string;
  billToClient: boolean;
  clientAmount: number | null | undefined;
  consent: ClientConsentState;
  propertyHasClient: boolean;
}): string | null {
  if (!input.billToClient) return "Not billed to the client.";
  if (input.status !== "APPROVED") return "Only an approved request is billed to the client.";
  if (!input.propertyHasClient) return "The property has no client to bill.";
  const amount = Number(input.clientAmount);
  if (input.clientAmount == null || !Number.isFinite(amount)) return "No client amount is set.";
  if (amount <= 0) return "The client amount must be more than $0.00.";
  if (input.consent === "AWAITING") return "Waiting for the client to approve this extra.";
  if (input.consent === "DECLINED") return "The client declined this extra, so it is not billed.";
  return null;
}
