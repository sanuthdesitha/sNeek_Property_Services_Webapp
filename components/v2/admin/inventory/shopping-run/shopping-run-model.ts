/**
 * Shopping run page labels (board "Shopping run", 2026-11-17). PLAIN module.
 * Words only: amounts come from the run service and are formatted, never
 * computed, by the page.
 */
import type { ShoppingRunAdminView } from "@/lib/inventory/shopping-runs";

export type ShoppingRunView = ShoppingRunAdminView;

export const RUN_STATUS_LABEL: Record<ShoppingRunView["status"], string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};
export const RUN_STATUSES: ShoppingRunView["status"][] = ["DRAFT", "IN_PROGRESS", "COMPLETED"];

export const REIMBURSEMENT_LABEL: Record<ShoppingRunView["cleanerReimbursementStatus"], string> = {
  NOT_APPLICABLE: "Not applicable",
  PENDING_APPROVAL: "Awaiting your approval",
  READY: "Approved, payable",
  INVOICED: "On a cleaner invoice",
  REIMBURSED: "Reimbursed",
};
export const REIMBURSEMENT_STATUSES: ShoppingRunView["cleanerReimbursementStatus"][] = ["NOT_APPLICABLE", "PENDING_APPROVAL", "READY", "INVOICED", "REIMBURSED"];

export const CLIENT_CHARGE_LABEL: Record<ShoppingRunView["clientChargeStatus"], string> = {
  NOT_REQUIRED: "Not required",
  READY: "Ready",
  SENT: "Sent",
  PAID: "Paid",
};
export const CLIENT_CHARGE_STATUSES: ShoppingRunView["clientChargeStatus"][] = ["NOT_REQUIRED", "READY", "SENT", "PAID"];

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  COMPANY_CARD: "Company card",
  CLIENT_CARD: "Client's card",
  CLEANER_PERSONAL_CARD: "Cleaner's own card",
  ADMIN_PERSONAL_CARD: "Office person's own card",
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};
export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL);

/** A cleaner paid out of pocket, so a reimbursement is owed (or was). */
export function isCleanerPaid(run: Pick<ShoppingRunView, "payment">): boolean {
  return run.payment.paidByScope === "CLEANER";
}

export function firstName(name: string | undefined | null): string {
  const value = (name ?? "").trim();
  return value.split(" ")[0] || value || "the cleaner";
}

export const SHOPPING_RUNS_BACK = "/v2/admin/inventory?tab=shopping-runs";
