/**
 * Approving a cleaner's claimed shopping reimbursement (board "Shopping run",
 * owner defaults 2026-11-17, pending owner confirmation). PLAIN module: the
 * run service, the route and the page read the same rule.
 *
 * - Approval moves the claim out of PENDING_APPROVAL into a payable state
 *   (READY, or straight to INVOICED / REIMBURSED from an older screen). It
 *   needs the approver's id, so it is audited with the actual actor.
 * - It needs at least one receipt on the run. Without one, the office can
 *   still approve with a typed note; the note is kept in the audit row.
 * - It is allowed while a bought line has no cost: the claim is the costed
 *   amount (a missing cost was never counted), and the audit names the line.
 * - Administrators and operations managers approve, as before.
 * - Asking for a status the claim already has is not an approval and writes
 *   nothing, so a retry cannot approve twice.
 */

export type ShoppingReimbursementApprovalInput = {
  /** The actual signed-in person (never the account being tested as). */
  actorId: string;
  /** Required only when the run has no receipt. */
  overrideNote?: string | null;
};

export type ShoppingReimbursementRefusalCode = "RECEIPT_REQUIRED" | "APPROVER_REQUIRED";

export class ShoppingReimbursementRefusal extends Error {
  readonly code: ShoppingReimbursementRefusalCode;
  readonly status = 409;
  constructor(code: ShoppingReimbursementRefusalCode, message: string) {
    super(message);
    this.name = "ShoppingReimbursementRefusal";
    this.code = code;
  }
}

export const RECEIPT_REQUIRED_MESSAGE =
  "Attach a receipt before approving this reimbursement, or approve without one and say why.";

const PAYABLE = new Set(["READY", "INVOICED", "REIMBURSED"]);

export function isReimbursementApproval(from: string, to: string): boolean {
  return from === "PENDING_APPROVAL" && PAYABLE.has(to);
}

/** Null when the move may go ahead; otherwise the refusal to throw. */
export function reimbursementApprovalRefusal(input: {
  from: string;
  to: string;
  receiptCount: number;
  approval: ShoppingReimbursementApprovalInput | null;
}): ShoppingReimbursementRefusal | null {
  if (!isReimbursementApproval(input.from, input.to)) return null;
  if (!input.approval?.actorId) {
    return new ShoppingReimbursementRefusal("APPROVER_REQUIRED", "Approving a reimbursement needs the approver.");
  }
  if (input.receiptCount < 1 && !input.approval.overrideNote?.trim()) {
    return new ShoppingReimbursementRefusal("RECEIPT_REQUIRED", RECEIPT_REQUIRED_MESSAGE);
  }
  return null;
}
