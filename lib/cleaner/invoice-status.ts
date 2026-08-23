/**
 * WHAT EACH PAYEE-INVOICE STATUS MEANS FOR THE WORK ON IT.
 *
 * `CleanerInvoiceSubmission.status` is a plain string, and the consequences of
 * moving between its values were spelled out inline at three separate points in
 * the admin route: whether to release the payee's items, whether to free the
 * jobs, and whether to wipe the payment record. Three copies of one rule is how
 * a fourth status gets added and two of them are updated.
 *
 * The distinction that matters:
 *
 *   VOID              — this invoice is finished with. The work goes back so it
 *                       can appear on a different one.
 *   CHANGES_REQUESTED — the office wants a BETTER invoice for the same work. The
 *                       work also goes back, because a payee told to fix an
 *                       invoice cannot rebuild it while every line on it is
 *                       still stamped as already billed.
 *   SUBMITTED         — reopened for review. The review consumed nothing, so
 *                       nothing is released; only a stale payment record goes.
 *
 * PURE — no database.
 */

export type PayeeInvoiceStatus =
  | "SENDING"
  | "SUBMITTED"
  | "CHANGES_REQUESTED"
  | "XERO_PUSHED"
  | "PAID_CLAIMED"
  | "PAID"
  | "VOID";

/**
 * Does moving to this status hand the payee's work back?
 *
 * Both cancelling states do. Getting it wrong is bad in a different way each
 * direction: forgetting to release strands money the payee is owed with no way
 * for them to discover it, and releasing while the invoice is still live would
 * let the same work be billed twice.
 */
export function releasesPayeeWork(status: string): boolean {
  return status === "VOID" || status === "CHANGES_REQUESTED";
}

/**
 * Does moving to this status wipe the recorded payment?
 *
 * Only an explicit reversal should. This once caught EVERY non-PAID status, so
 * moving a paid invoice to any other state — including ones with nothing to do
 * with payment — silently erased when it was paid, how much, by what method and
 * into which account. That is the audit trail for money that actually left the
 * business, deleted as a side effect.
 */
export function clearsPaymentRecord(status: string): boolean {
  return status === "VOID" || status === "SUBMITTED" || status === "CHANGES_REQUESTED";
}

/**
 * Does this status require a note explaining it?
 *
 * Sending an invoice back without saying what is wrong reliably produces the
 * same invoice again, and the payee has no way to guess which of twenty lines
 * the office disagreed with.
 */
export function requiresChangesNote(status: string): boolean {
  return status === "CHANGES_REQUESTED";
}

/** Should the stored "what to fix" note be cleared as the invoice moves on? */
export function clearsChangesNote(status: string): boolean {
  return status !== "CHANGES_REQUESTED";
}
