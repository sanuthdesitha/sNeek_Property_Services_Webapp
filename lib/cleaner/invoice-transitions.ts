/**
 * Cleaner (payee) invoice transitions: the one table the admin routes, the
 * bulk route and the screen all read, like lib/finance/invoice-transitions.ts
 * for client invoices. PURE — no database.
 *
 *   SENDING ──review delivery──▶ SUBMITTED | VOID
 *   SUBMITTED ──approve (ADMIN only)──▶ APPROVED
 *   SUBMITTED | APPROVED ──request changes──▶ CHANGES_REQUESTED
 *   SUBMITTED | APPROVED ──reverse──▶ VOID
 *   APPROVED | XERO_EXPORTING ──push to Xero──▶ XERO_PUSHED
 *   APPROVED | XERO_PUSHED | PAID_CLAIMED ──record payment──▶ PAID
 *   PAID_CLAIMED ──reject claim──▶ SUBMITTED (XERO_PUSHED when a Xero bill exists)
 *
 * Owner decision (2026-11-11): only an administrator approves. Push to Xero and
 * Record payment need APPROVED, or a later state they already allowed
 * (XERO_EXPORTING retry, XERO_PUSHED, PAID_CLAIMED). Existing rows keep their
 * status: a legacy SUBMITTED invoice is approved first; a legacy XERO_PUSHED
 * one can still be paid. Nothing changes once paid, voided or exported except
 * the moves above that those states already allowed.
 */

export type CleanerInvoiceStatus =
  | "SENDING"
  | "SUBMITTED"
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "XERO_EXPORTING"
  | "XERO_PUSHED"
  | "PAID_CLAIMED"
  | "PAID"
  | "VOID";

export type CleanerInvoiceAction =
  | "approve"
  | "request-changes"
  | "push-xero"
  | "record-payment"
  | "reject-claim"
  | "reverse"
  | "delete"
  | "review-delivery";

export type CleanerInvoiceFacts = {
  status: string;
  xeroBillId: string | null;
  paidAt: Date | string | null;
  paidAmount: number | null;
};

export type TransitionRole = "ADMIN" | "OPS_MANAGER" | string;

export type TransitionAnswer =
  | { ok: true; to: CleanerInvoiceStatus | null }
  | { ok: false; status: 403 | 409; reason: string };

const hasPayment = (facts: CleanerInvoiceFacts) => Boolean(facts.paidAt) || facts.paidAmount != null;
const inXero = (facts: CleanerInvoiceFacts) => Boolean(facts.xeroBillId);

const SETTLED_REFUSAL = "This change would alter settled, exported or released work. Use a reconciled correction instead.";

type Rule = {
  from: readonly string[];
  /** Where it lands; null for delete (row removed) and delivery review (decided by the reviewer). */
  to: (facts: CleanerInvoiceFacts) => CleanerInvoiceStatus | null;
  allowXeroBill: boolean;
  adminOnly?: boolean;
  refusal: string;
};

const RULES: Record<CleanerInvoiceAction, Rule> = {
  approve: {
    from: ["SUBMITTED"],
    to: () => "APPROVED",
    allowXeroBill: false,
    adminOnly: true,
    refusal: "Only a submitted invoice that is not in Xero or paid can be approved.",
  },
  "request-changes": {
    from: ["SUBMITTED", "APPROVED"],
    to: () => "CHANGES_REQUESTED",
    allowXeroBill: false,
    refusal: "Changes can be requested only on a submitted or approved invoice that is not in Xero or paid.",
  },
  "push-xero": {
    from: ["APPROVED", "XERO_EXPORTING"],
    to: () => "XERO_PUSHED",
    allowXeroBill: false,
    refusal: "Approve this invoice before pushing it to Xero. Only an unpaid approved invoice can be exported.",
  },
  "record-payment": {
    from: ["APPROVED", "XERO_PUSHED", "PAID_CLAIMED"],
    to: () => "PAID",
    allowXeroBill: true,
    refusal: "Approve this invoice before recording a payment. A paid, void or sent-back invoice cannot be paid again.",
  },
  "reject-claim": {
    from: ["PAID_CLAIMED"],
    to: (facts) => (inXero(facts) ? "XERO_PUSHED" : "SUBMITTED"),
    allowXeroBill: true,
    refusal: "Only a payment claim can be rejected.",
  },
  reverse: {
    from: ["SUBMITTED", "APPROVED"],
    to: () => "VOID",
    allowXeroBill: false,
    refusal: "Only a submitted or approved invoice that is not in Xero or paid can be reversed.",
  },
  delete: {
    from: ["SUBMITTED", "APPROVED", "CHANGES_REQUESTED", "PAID_CLAIMED", "VOID"],
    to: () => null,
    allowXeroBill: false,
    refusal: "This invoice is already in Xero or paid. Void it in Xero before deleting.",
  },
  "review-delivery": {
    from: ["SENDING"],
    to: () => null,
    allowXeroBill: false,
    refusal: "Only an invoice awaiting delivery review can be resolved.",
  },
};

/** May this role take this action on an invoice in this state, and where does it land? */
export function cleanerInvoiceTransition(action: CleanerInvoiceAction, facts: CleanerInvoiceFacts, role: TransitionRole): TransitionAnswer {
  const rule = RULES[action];
  if (rule.adminOnly && role !== "ADMIN") {
    return { ok: false, status: 403, reason: "Only an administrator can approve cleaner invoices." };
  }
  if (!rule.from.includes(facts.status) || hasPayment(facts) || (!rule.allowXeroBill && inXero(facts))) {
    return { ok: false, status: 409, reason: rule.refusal };
  }
  return { ok: true, to: rule.to(facts) };
}

/** The action a PATCH { status } asks for, given where the invoice is now. */
export function actionForTargetStatus(from: string, to: string): CleanerInvoiceAction | null {
  switch (to) {
    case "APPROVED":
      return "approve";
    case "CHANGES_REQUESTED":
      return "request-changes";
    case "PAID":
      return "record-payment";
    case "VOID":
      return "reverse";
    // The Approval Center's "reject claim" sends SUBMITTED; the table decides
    // whether it lands on SUBMITTED or back on XERO_PUSHED.
    case "SUBMITTED":
      return from === "PAID_CLAIMED" ? "reject-claim" : null;
    default:
      // XERO_PUSHED is only ever set by the push itself.
      return null;
  }
}

export { SETTLED_REFUSAL };

const ORDER: CleanerInvoiceAction[] = ["approve", "push-xero", "record-payment", "reject-claim", "request-changes", "review-delivery", "reverse", "delete"];

/** Every action this role may take on this invoice now, in menu order. */
export function availableCleanerInvoiceActions(facts: CleanerInvoiceFacts, role: TransitionRole): CleanerInvoiceAction[] {
  return ORDER.filter((action) => cleanerInvoiceTransition(action, facts, role).ok);
}

/**
 * The one action shown on the row: Submitted → Review (ADMIN approves on the
 * review page); Approved → Push to Xero; In Xero → Record payment; Payment
 * claimed → Review payment; delivery review → Review delivery. Null means the
 * row leads with "View".
 */
export type CleanerPrimaryAction = "review" | "push-xero" | "record-payment" | "review-payment" | "review-delivery" | "view";

export function primaryCleanerInvoiceAction(facts: CleanerInvoiceFacts, role: TransitionRole): CleanerPrimaryAction {
  const can = (action: CleanerInvoiceAction) => cleanerInvoiceTransition(action, facts, role).ok;
  if (facts.status === "SENDING" && can("review-delivery")) return "review-delivery";
  if (facts.status === "SUBMITTED") return "review";
  if (facts.status === "PAID_CLAIMED") return "review-payment";
  if (can("push-xero")) return "push-xero";
  if (can("record-payment")) return "record-payment";
  return "view";
}

/** Payee-invoice statuses that still need the office (badge and "Needs action" chip). */
export const CLEANER_NEEDS_ACTION_STATUSES = ["SENDING", "SUBMITTED", "APPROVED", "XERO_EXPORTING", "PAID_CLAIMED"] as const;

export const CLEANER_INVOICE_STATUS_LABEL: Record<CleanerInvoiceStatus, string> = {
  SENDING: "Delivery review",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  XERO_EXPORTING: "Xero export pending",
  XERO_PUSHED: "In Xero",
  PAID_CLAIMED: "Payment claimed",
  PAID: "Paid",
  VOID: "Reversed",
};
