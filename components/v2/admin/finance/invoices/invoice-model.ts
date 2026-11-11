/**
 * Client-invoice screen model: types, labels, formatters and the rule that
 * decides which actions a row offers. Moved out of the old 1,698-line
 * estate-invoices.tsx; the availability conditions are the ones that file
 * applied to its row buttons, unchanged.
 */
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { StartedWorkReview } from "@/lib/billing/started-work-reconciliation";
import type {
  ClientInvoiceListRow,
  ClientInvoiceStatusValue,
} from "@/lib/billing/client-invoice-list-types";

export type InvoiceStatus = ClientInvoiceStatusValue;
/** One row of the paged list (server shape). */
export type InvoiceRow = ClientInvoiceListRow;

export type InvoiceClient = { id: string; name: string; email: string | null };
export type InvoiceProperty = { id: string; name: string; suburb: string; clientId: string };
export type InvoiceFormContext = { clients: InvoiceClient[]; properties: InvoiceProperty[] };

export type PaymentLedgerEntry = {
  amount: number;
  method: string;
  reference: string | null;
  paidDate: string;
  recordedAt: string;
  recordedById?: string;
  recordedByName?: string;
};

export type LineProperty = { id: string; name: string; suburb: string };
export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category: string;
  /** Job-backed lines carry their property through the job. */
  job?: { id: string; jobNumber: string | null; scheduledDate: string; property: LineProperty | null } | null;
  /** Manual lines only — a grouping hint the admin sets by hand. */
  property?: LineProperty | null;
};

export type FullInvoice = {
  id: string;
  /** Server-side reconciliation: stored total disagrees with the lines. */
  totalsMismatch?: boolean;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  gstEnabled?: boolean;
  lines: InvoiceLine[];
  paidAmount?: number | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidDate?: string | null;
  paidAt?: string | null;
  updatedAt: string;
  startedWorkStatus?: { requiresReview: boolean; changedJobIds: string[]; error?: string } | null;
  metadata?: { payments?: PaymentLedgerEntry[]; startedWorkReview?: StartedWorkReview } | null;
};

export const PAY_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "STRIPE", label: "Stripe" },
  { value: "OTHER", label: "Other" },
];

export const PAY_METHOD_LABEL: Record<string, string> = {
  ...Object.fromEntries(PAY_METHODS.map((m) => [m.value, m.label])),
  // One-click "Mark as paid" — not offered in the record-payment dropdown,
  // but shown in the ledger/receipt for payments recorded that way.
  MANUAL: "Marked as paid",
  // Recorded by the Xero status pull, never chosen by hand.
  XERO: "Xero",
};

/** Statuses on which a payment can be recorded / the invoice marked paid. */
export const PAYABLE_STATUSES: InvoiceStatus[] = ["DRAFT", "APPROVED", "SENT", "PART_PAID"];

export const STATUS_TONE: Record<InvoiceStatus, "warning" | "info" | "primary" | "success" | "neutral" | "gold"> = {
  DRAFT: "warning",
  APPROVED: "info",
  SENT: "primary",
  PART_PAID: "gold",
  PAID: "success",
  VOID: "neutral",
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
  PART_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

export const XERO_LABEL: Record<InvoiceRow["xeroState"], string> = {
  NONE: "Not in Xero",
  PUSHED: "In Xero",
  PENDING: "Xero pending or failed",
};

export const money = (v: number | null | undefined) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(v ?? 0));

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return format(new Date(v), "dd MMM yyyy");
  } catch {
    return v;
  }
}

/** A moment in the organisation's timezone (Sydney, as the list's due days). */
export function fmtStamp(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return formatInTimeZone(new Date(v), "Australia/Sydney", "d MMM, HH:mm");
  } catch {
    return v;
  }
}

/** A calendar day (yyyy-MM-dd) shown without any timezone shift. */
export function fmtDay(day: string | null | undefined) {
  if (!day) return "—";
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return format(new Date(year, month - 1, date), "dd MMM yyyy");
}

/* ── Row actions ───────────────────────────────────────────────────────── */

export type InvoiceActionKey =
  | "edit"
  | "pdf"
  | "approve"
  | "send"
  | "resend"
  | "record-payment"
  | "mark-paid"
  | "receipt"
  | "xero-push"
  | "xero-retry"
  | "void"
  | "reverse"
  | "reconcile"
  | "delete"
  | "credit-note";

export const ACTION_LABEL: Record<InvoiceActionKey, string> = {
  edit: "Review and edit",
  pdf: "View PDF",
  approve: "Approve",
  send: "Send",
  resend: "Re-send",
  "record-payment": "Record payment",
  "mark-paid": "Mark as paid",
  receipt: "Payment record",
  "xero-push": "Push to Xero",
  "xero-retry": "Retry Xero",
  void: "Void",
  reverse: "Reverse to draft",
  reconcile: "Reconcile / void",
  delete: "Delete",
  "credit-note": "Issue credit note",
};

type ActionFacts = Pick<
  InvoiceRow,
  "status" | "xeroInvoiceId" | "xeroExportedAt" | "paidAt" | "paidAmount" | "xeroState" | "overdue"
> &
  Partial<Pick<InvoiceRow, "kind" | "fullyCredited">>;

/** Sent, part-paid or paid invoices are corrected by a credit note (owner decision 2026-11-11). */
const CREDITABLE_STATUSES: InvoiceStatus[] = ["SENT", "PART_PAID", "PAID"];

const inXero = (inv: ActionFacts) => Boolean(inv.xeroInvoiceId || inv.xeroExportedAt);
const hasPayment = (inv: ActionFacts) => Boolean(inv.paidAt) || Boolean(Number(inv.paidAmount ?? 0));

/**
 * Every action that exists for this invoice, using the exact conditions the
 * old row applied to its buttons. Re-send is new on screen; the send route
 * already accepted SENT and PART_PAID (PART_PAID keeps its status).
 */
export function availableInvoiceActions(inv: ActionFacts): InvoiceActionKey[] {
  const actions: InvoiceActionKey[] = [];
  const creditNote = inv.kind === "CREDIT_NOTE";
  if (inv.status === "DRAFT" || inv.status === "APPROVED") actions.push("edit");
  actions.push("pdf");
  if (inv.status === "DRAFT") actions.push("approve");
  if (inv.status === "DRAFT" || inv.status === "APPROVED") actions.push("send");
  if (inv.status === "SENT" || inv.status === "PART_PAID") actions.push("resend");
  // A credit note is never paid: it reduces what is owed on its invoice.
  if (!creditNote && PAYABLE_STATUSES.includes(inv.status)) actions.push("record-payment", "mark-paid");
  if (!creditNote && (inv.status === "PAID" || inv.status === "PART_PAID")) actions.push("receipt");
  // A credit note goes to Xero once issued (approved or sent), as the server requires.
  const pushable = creditNote ? inv.status === "APPROVED" || inv.status === "SENT" : inv.status !== "VOID";
  if (pushable) actions.push(inv.xeroState === "PENDING" ? "xero-retry" : "xero-push");
  if (!creditNote && !inv.fullyCredited && CREDITABLE_STATUSES.includes(inv.status)) actions.push("credit-note");
  if (!inXero(inv) && (inv.status === "SENT" || inv.status === "APPROVED")) actions.push("void");
  // Reverse is for an approved invoice nobody outside the office has seen; once
  // sent, "Issue credit note" replaces it.
  if (!inXero(inv) && !hasPayment(inv) && inv.status === "APPROVED") actions.push("reverse");
  if (inXero(inv) && inv.status !== "VOID" && !hasPayment(inv)) actions.push("reconcile");
  if (inv.status === "DRAFT" && !inXero(inv)) actions.push("delete");
  return actions;
}

/**
 * The ONE action shown on the row, chosen from its state: a pending or failed
 * Xero export first (nothing else can safely change until it is resolved),
 * then the next lifecycle step. An overdue sent invoice leads with a reminder
 * (the existing re-send), otherwise with recording the payment.
 */
export function primaryInvoiceAction(inv: ActionFacts): InvoiceActionKey {
  if (inv.status !== "VOID" && inv.xeroState === "PENDING") return "xero-retry";
  switch (inv.status) {
    case "DRAFT":
      return "edit";
    case "APPROVED":
      return "send";
    case "SENT":
    case "PART_PAID":
      if (inv.kind === "CREDIT_NOTE" || inv.fullyCredited) return "pdf";
      return inv.overdue ? "resend" : "record-payment";
    case "PAID":
      return inv.kind === "CREDIT_NOTE" ? "pdf" : "receipt";
    default:
      return "pdf";
  }
}

/** Words for an action on this row. */
export function invoiceActionLabel(key: InvoiceActionKey, inv: ActionFacts): string {
  if (key === "edit" && inv.status === "DRAFT") return "Review";
  if (key === "resend" && inv.overdue) return "Send reminder";
  if (key === "xero-push" && inv.xeroState === "PUSHED") return "Push to Xero (already in Xero)";
  return ACTION_LABEL[key];
}

/** Primary action plus the rest, for the row menu. */
export function invoiceRowActions(inv: ActionFacts): { primary: InvoiceActionKey; secondary: InvoiceActionKey[] } {
  const primary = primaryInvoiceAction(inv);
  return { primary, secondary: availableInvoiceActions(inv).filter((key) => key !== primary) };
}

/** Destructive or correcting actions are drawn apart in the menu. */
export const CORRECTION_ACTIONS: ReadonlySet<InvoiceActionKey> = new Set<InvoiceActionKey>(["void", "reverse", "reconcile", "delete"]);

/* ── Editor page actions ───────────────────────────────────────────────── */

/**
 * The editor page's one primary action: the list's choice (same function),
 * except that the list's "Review" opens this page, so on the page a draft
 * leads with its next step, Approve. Null when the list's choice is the PDF,
 * which the page already offers as "Preview PDF".
 */
export function editorPrimaryAction(inv: ActionFacts): InvoiceActionKey | null {
  const primary = primaryInvoiceAction(inv);
  if (primary === "edit") return "approve";
  if (primary === "pdf") return null;
  return primary;
}

/** Every other existing action for the page's "more" menu (no "edit": this is the editor). */
export function editorMenuActions(inv: ActionFacts): InvoiceActionKey[] {
  const primary = editorPrimaryAction(inv);
  return availableInvoiceActions(inv).filter((key) => key !== primary && key !== "edit");
}

/** Actions that act on the stored invoice, so unsaved edits must be saved first. */
export const ACTS_ON_SAVED_INVOICE: ReadonlySet<InvoiceActionKey> = new Set<InvoiceActionKey>([
  "approve",
  "send",
  "resend",
  "record-payment",
  "mark-paid",
  "xero-push",
  "xero-retry",
  "void",
  "reverse",
  "reconcile",
  "credit-note",
]);
