/**
 * Pay run page presentation rules (board "Pay run", 2026-11-17). PLAIN module:
 * no "use client", no database, so the server page, the routes' tests and the
 * client components read the same rules.
 *
 * Nothing here computes money. Stages come from the run's stored dates and
 * status; problem flags come from the payout's stored method and bank/Stripe
 * snapshot; the primary action follows the same status rules the routes
 * enforce (process needs CONFIRMED and ADMIN; run status needs ADMIN).
 */
import type { EStage } from "@/components/v2/ui/stage-bar";

export type PayrollRunStatusName = "DRAFT" | "CONFIRMED" | "PROCESSING" | "COMPLETED" | "FAILED" | "VOID";
export type PayoutStatusName = "PENDING" | "PROCESSING" | "PAID" | "FAILED" | "CANCELLED" | "REFUNDED";
export type PayoutMethodName = "STRIPE_CONNECT" | "ABA_FILE" | "MANUAL_BANK_TRANSFER";

export const PAYROLL_RUN_STATUS_LABEL: Record<PayrollRunStatusName, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  VOID: "Void",
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatusName, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const PAYOUT_METHOD_LABEL: Record<PayoutMethodName, string> = {
  STRIPE_CONNECT: "Stripe Connect",
  ABA_FILE: "Bank transfer",
  MANUAL_BANK_TRANSFER: "Bank transfer",
};

export const RUN_STATUSES: PayrollRunStatusName[] = ["DRAFT", "CONFIRMED", "PROCESSING", "COMPLETED", "FAILED", "VOID"];
export const PAYOUT_STATUSES: PayoutStatusName[] = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED", "REFUNDED"];

/** The stored facts of one payout the flags read. */
export type PayoutFlagFacts = {
  status: string;
  method: string;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  stripeAccountId: string | null;
};

export type PayoutProblemCode = "NO_BANK_DETAILS" | "STRIPE_SETUP_UNFINISHED" | "STRIPE_NOT_CONFIGURED";

export type PayoutProblem = {
  code: PayoutProblemCode;
  /** The pill text in the leading cell. */
  label: string;
  /** The line under the method, saying what it means for the money. */
  detail: string;
};

const SETTLED_PAYOUT = new Set(["PAID", "CANCELLED", "REFUNDED"]);

export function isBankPayout(method: string): boolean {
  return method === "ABA_FILE" || method === "MANUAL_BANK_TRANSFER";
}

/**
 * Problems before money moves. Read from the payout's own snapshot; a paid,
 * cancelled or refunded payout has nothing left to go wrong. Processing is not
 * blocked by these (owner default 2026-11-17): the payout stays Pending and is
 * named.
 */
export function payoutProblems(payout: PayoutFlagFacts, context: { stripeConfigured: boolean }): PayoutProblem[] {
  if (SETTLED_PAYOUT.has(payout.status)) return [];
  const problems: PayoutProblem[] = [];
  if (isBankPayout(payout.method) && (!payout.bankBsb?.trim() || !payout.bankAccountNumber?.trim())) {
    problems.push({ code: "NO_BANK_DETAILS", label: "No bank details", detail: "Cannot go in the ABA file" });
  }
  if (payout.method === "STRIPE_CONNECT" && !payout.stripeAccountId?.trim()) {
    problems.push({ code: "STRIPE_SETUP_UNFINISHED", label: "Stripe set-up not finished", detail: "No Stripe account on this payout; it stays Pending" });
  }
  if (payout.method === "STRIPE_CONNECT" && payout.stripeAccountId?.trim() && !context.stripeConfigured) {
    problems.push({ code: "STRIPE_NOT_CONFIGURED", label: "Stripe not set up", detail: "This server has no Stripe key, so sending will fail" });
  }
  return problems;
}

/** "acct ending 412" from a stored account number; never the whole number. */
export function accountEnding(accountNumber: string | null | undefined): string | null {
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  return digits.length ? digits.slice(-3) : null;
}

export type PayrollStageFacts = {
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
};

export type PayrollStageView = { terminal: { title: string; description: string } | null; stages: EStage[] };

/**
 * Stages from stored state. Processing has no stored start time, so its note
 * says what the status says, never an invented time.
 */
export function payrollRunStages(facts: PayrollStageFacts, formatStamp: (iso: string) => string): PayrollStageView {
  const status = facts.status as PayrollRunStatusName;
  if (status === "VOID") {
    return { terminal: { title: "Void", description: "Voided: read only. Payslips still open." }, stages: [] };
  }
  const order: PayrollRunStatusName[] = ["DRAFT", "CONFIRMED", "PROCESSING", "COMPLETED"];
  const reached = status === "FAILED" ? 2 : order.indexOf(status);
  const draft: EStage = { key: "draft", label: "Draft", state: reached === 0 ? "current" : "done", note: formatStamp(facts.createdAt) };
  const confirmed: EStage = reached < 1
    ? { key: "confirmed", label: "Confirmed", state: "todo", note: "Not yet" }
    : { key: "confirmed", label: "Confirmed", state: reached === 1 ? "current" : facts.confirmedAt ? "done" : "passed", note: facts.confirmedAt ? `${formatStamp(facts.confirmedAt)} · totals frozen` : "Time not recorded" };
  const processing: EStage = status === "FAILED"
    ? { key: "processing", label: "Processing", state: "pending", note: "Failed" }
    : reached < 2
      ? { key: "processing", label: "Processing", state: "todo", note: "Not yet" }
      : { key: "processing", label: "Processing", state: reached === 2 ? "current" : "done", note: reached === 2 ? "Sending now" : null };
  const completed: EStage = status === "COMPLETED"
    ? { key: "completed", label: "Completed", state: "done", note: facts.completedAt ? formatStamp(facts.completedAt) : "Time not recorded" }
    : { key: "completed", label: "Completed", state: "todo", note: "Not yet" };
  return { terminal: null, stages: [draft, confirmed, processing, completed] };
}

export type PayrollPrimaryAction =
  | { kind: "confirm" }
  | { kind: "process" }
  | { kind: "process-admin-only"; hint: string }
  | { kind: "set-back-confirmed" }
  | { kind: "failed-admin-only"; hint: string }
  | { kind: "download-aba" }
  | { kind: "none" };

/** One primary action per stage, following the routes' own rules. */
export function payrollPrimaryAction(status: string, isAdmin: boolean): PayrollPrimaryAction {
  switch (status) {
    case "DRAFT":
      return { kind: "confirm" };
    case "CONFIRMED":
      return isAdmin ? { kind: "process" } : { kind: "process-admin-only", hint: "Only an administrator can send payouts." };
    case "FAILED":
      return isAdmin
        ? { kind: "set-back-confirmed" }
        : { kind: "failed-admin-only", hint: "Processing is only for a Confirmed run. An administrator can set it back to Confirmed." };
    case "PROCESSING":
    case "COMPLETED":
      return { kind: "download-aba" };
    default:
      return { kind: "none" };
  }
}

/** The ABA file can be made once the run is confirmed (lib/payroll/aba.ts). */
export function abaAvailable(status: string): boolean {
  return status === "CONFIRMED" || status === "PROCESSING" || status === "COMPLETED" || status === "FAILED";
}

/** Payout filter chips; counts come from the rows the server sent. */
export type PayoutFilter = "all" | "attention" | "stripe" | "bank";

export function payoutMatchesFilter(
  payout: PayoutFlagFacts & { problems: PayoutProblem[] },
  filter: PayoutFilter,
): boolean {
  if (filter === "attention") return payout.problems.length > 0 || payout.status === "FAILED";
  if (filter === "stripe") return payout.method === "STRIPE_CONNECT";
  if (filter === "bank") return isBankPayout(payout.method);
  return true;
}

/** Failed and flagged payouts first (phone and desktop), otherwise the server's order. */
export function attentionFirst<T extends PayoutFlagFacts & { problems: PayoutProblem[] }>(rows: T[]): T[] {
  const rank = (row: T) => (row.status === "FAILED" ? 0 : row.problems.length ? 1 : 2);
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map((entry) => entry.row);
}
