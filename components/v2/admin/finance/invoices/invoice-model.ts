/**
 * Client-invoice screen model: types, labels, formatters and the rule that
 * decides which actions a row offers. Moved out of the old 1,698-line
 * estate-invoices.tsx; the availability conditions are the ones that file
 * applied to its row buttons, unchanged.
 */
import { format } from "date-fns";
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
  | "delete";

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
};

type ActionFacts = Pick<InvoiceRow, "status" | "xeroInvoiceId" | "xeroExportedAt" | "paidAt" | "paidAmount" | "xeroState">;

const inXero = (inv: ActionFacts) => Boolean(inv.xeroInvoiceId || inv.xeroExportedAt);
const hasPayment = (inv: ActionFacts) => Boolean(inv.paidAt) || Boolean(Number(inv.paidAmount ?? 0));

/**
 * Every action that exists for this invoice, using the exact conditions the
 * old row applied to its buttons. Re-send is new on screen; the send route
 * already accepted SENT and PART_PAID (PART_PAID keeps its status).
 */
export function availableInvoiceActions(inv: ActionFacts): InvoiceActionKey[] {
  const actions: InvoiceActionKey[] = [];
  if (inv.status === "DRAFT" || inv.status === "APPROVED") actions.push("edit");
  actions.push("pdf");
  if (inv.status === "DRAFT") actions.push("approve");
  if (inv.status === "DRAFT" || inv.status === "APPROVED") actions.push("send");
  if (inv.status === "SENT" || inv.status === "PART_PAID") actions.push("resend");
  if (PAYABLE_STATUSES.includes(inv.status)) actions.push("record-payment", "mark-paid");
  if (inv.status === "PAID" || inv.status === "PART_PAID") actions.push("receipt");
  if (inv.status !== "VOID") actions.push(inv.xeroState === "PENDING" ? "xero-retry" : "xero-push");
  if (!inXero(inv) && (inv.status === "SENT" || inv.status === "APPROVED")) actions.push("void");
  if (!inXero(inv) && !hasPayment(inv) && (inv.status === "APPROVED" || inv.status === "SENT")) actions.push("reverse");
  if (inXero(inv) && inv.status !== "VOID" && !hasPayment(inv)) actions.push("reconcile");
  if (inv.status === "DRAFT" && !inXero(inv)) actions.push("delete");
  return actions;
}

/**
 * The ONE action shown on the row, chosen from its state: a pending or failed
 * Xero export first (nothing else can safely change until it is resolved),
 * then the next lifecycle step.
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
      return "record-payment";
    case "PAID":
      return "receipt";
    default:
      return "pdf";
  }
}

/** Primary action plus the rest, for the row menu. */
export function invoiceRowActions(inv: ActionFacts): { primary: InvoiceActionKey; secondary: InvoiceActionKey[] } {
  const primary = primaryInvoiceAction(inv);
  return { primary, secondary: availableInvoiceActions(inv).filter((key) => key !== primary) };
}

/** Destructive or correcting actions are drawn apart in the menu. */
export const CORRECTION_ACTIONS: ReadonlySet<InvoiceActionKey> = new Set(["void", "reverse", "reconcile", "delete"]);
