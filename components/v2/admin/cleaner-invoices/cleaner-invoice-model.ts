/**
 * Cleaner-invoice screen model: the row type, labels, tones, formatters and
 * which actions a row offers (from the one transition table in
 * lib/cleaner/invoice-transitions.ts, so the screen and the API agree).
 */
import { formatInTimeZone } from "date-fns-tz";
import type { EPillTone } from "@/components/v2/ui/pill";
import type { CleanerInvoiceRow } from "@/lib/cleaner/invoice-admin-list-types";
import {
  CLEANER_INVOICE_STATUS_LABEL,
  availableCleanerInvoiceActions,
  primaryCleanerInvoiceAction,
  type CleanerInvoiceAction,
  type CleanerInvoiceStatus,
  type CleanerPrimaryAction,
} from "@/lib/cleaner/invoice-transitions";

export type CleanerRow = CleanerInvoiceRow;
export { CLEANER_INVOICE_STATUS_LABEL as STATUS_LABEL };

export const STATUS_PILL: Record<CleanerInvoiceStatus, EPillTone> = {
  SENDING: "warn",
  SUBMITTED: "info",
  APPROVED: "info",
  // Warning, not bad: the ball is back with the payee.
  CHANGES_REQUESTED: "warn",
  XERO_EXPORTING: "warn",
  XERO_PUSHED: "gold",
  PAID_CLAIMED: "gold",
  PAID: "ok",
  VOID: "neutral",
};

export const CLEANER_PAY_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "XERO", label: "Xero" },
  { value: "OTHER", label: "Other" },
];
export const CLEANER_PAY_METHOD_LABEL: Record<string, string> = Object.fromEntries(CLEANER_PAY_METHODS.map((m) => [m.value, m.label]));

const TZ = "Australia/Sydney";

export function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(value ?? 0));
}

/** Period boundaries and paid dates as Sydney calendar days. */
export function fmtDay(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return formatInTimeZone(new Date(value), TZ, "d MMM yyyy");
  } catch {
    return value;
  }
}

/** A moment in time, pinned to the business timezone. */
export function fmtStamp(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return formatInTimeZone(new Date(value), TZ, "d MMM yyyy, h:mma");
  } catch {
    return value;
  }
}

/** Best-effort read of the payee's bank account from the snapshot. */
export function bankFromLineData(lineData: unknown): string {
  if (!lineData || typeof lineData !== "object") return "";
  const data = lineData as Record<string, unknown>;
  const part = (value: unknown, prefix = "") => (typeof value === "string" && value.trim() ? `${prefix}${value.trim()}` : null);
  return [part(data.cleanerBankAccountName), part(data.cleanerBankBsb, "BSB "), part(data.cleanerBankAccountNumber, "Acc ")].filter(Boolean).join(" · ");
}

/** Every action the role may take (row menu and review page). */
export type CleanerUiAction = CleanerInvoiceAction | "view" | "pdf";

export const ACTION_LABEL: Record<CleanerUiAction, string> = {
  view: "View",
  pdf: "PDF",
  approve: "Approve",
  "request-changes": "Request changes",
  "push-xero": "Push to Xero",
  "record-payment": "Record payment",
  "reject-claim": "Reject payment claim",
  reverse: "Reverse",
  delete: "Delete",
  "review-delivery": "Review delivery",
};

export const PRIMARY_LABEL: Record<CleanerPrimaryAction, string> = {
  review: "Review",
  "push-xero": "Push to Xero",
  "record-payment": "Record payment",
  "review-payment": "Review payment",
  "review-delivery": "Review delivery",
  view: "View",
};

/** Corrections drawn apart at the end of the menu. */
export const CORRECTION_ACTIONS: ReadonlySet<CleanerUiAction> = new Set<CleanerUiAction>(["reverse", "delete"]);

export function cleanerRowActions(row: CleanerRow, role: string): { primary: CleanerPrimaryAction; menu: CleanerUiAction[] } {
  const primary = primaryCleanerInvoiceAction(row, role);
  const direct: Partial<Record<CleanerPrimaryAction, CleanerInvoiceAction>> = {
    "push-xero": "push-xero",
    "record-payment": "record-payment",
    "review-delivery": "review-delivery",
  };
  const shown = direct[primary];
  const actions = availableCleanerInvoiceActions(row, role).filter((action) => action !== shown);
  const menu: CleanerUiAction[] = [...(primary === "view" ? [] : (["view"] as CleanerUiAction[])), "pdf", ...actions];
  return { primary, menu };
}
