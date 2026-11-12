/**
 * The states of a "buy" ask and how they read. Pure (shared with the browser).
 * "Bought" is derived, never stored: the ask was accepted, the cleaner's run
 * was submitted with this item purchased, and the office approved the
 * cleaner's reimbursement (the existing shopping approval). Submitted but not
 * yet approved reads "Bought · awaiting office approval".
 */
export type PurchaseAskState = "ASKED" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | "BOUGHT" | "BOUGHT_AWAITING_APPROVAL";

export type AskRunFacts = {
  submittedAt: Date | null;
  reimbursementApproved: boolean;
  /** The run's line for the need's property and item, if still on the run. */
  line: { status: string; purchasedQty: number } | null;
} | null;

export const PURCHASE_ASK_LABEL: Record<PurchaseAskState, string> = {
  ASKED: "Asked",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  BOUGHT: "Bought",
  BOUGHT_AWAITING_APPROVAL: "Bought · awaiting office approval",
};

/** Pure. */
export function purchaseAskState(storedState: string, run: AskRunFacts): PurchaseAskState {
  if (storedState === "DECLINED" || storedState === "WITHDRAWN" || storedState === "ASKED") return storedState;
  const purchased = Boolean(run?.line && (run.line.status === "PURCHASED" || run.line.purchasedQty > 0));
  if (run?.submittedAt && purchased) return run.reimbursementApproved ? "BOUGHT" : "BOUGHT_AWAITING_APPROVAL";
  return "ACCEPTED";
}
