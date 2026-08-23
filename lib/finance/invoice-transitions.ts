/**
 * Client-invoice status transition graph (single source of truth for the
 * invoice PATCH endpoint and any UI that wants to pre-validate a move).
 *
 * Lifecycle: DRAFT → APPROVED → SENT → PART_PAID → PAID
 *  - SENT is reachable straight from DRAFT (the Send action is offered on
 *    drafts — approval is optional, not required).
 *  - VOID is reachable from any non-PAID status.
 *  - PAID is reachable directly from DRAFT / APPROVED / SENT / PART_PAID
 *    (one-click "Mark as paid" — invoices can be settled without sending).
 *  - PART_PAID is reachable from DRAFT / APPROVED / SENT (a partial payment
 *    can be recorded before or after sending).
 *  - PAID and VOID are terminal.
 */
const TRANSITIONS: Record<string, ReadonlySet<string>> = {
  DRAFT: new Set(["APPROVED", "SENT", "PART_PAID", "PAID", "VOID"]),
  APPROVED: new Set(["SENT", "PART_PAID", "PAID", "VOID"]),
  SENT: new Set(["PART_PAID", "PAID", "VOID"]),
  PART_PAID: new Set(["PAID", "VOID"]),
  PAID: new Set([]),
  VOID: new Set([]),
};

export function canTransitionInvoice(from: string, to: string): boolean {
  if (from === to) return true; // no-op PATCHes are always safe
  return TRANSITIONS[from]?.has(to) ?? false;
}

/** Where a reversal lands: the same invoice, editable again. */
export const REVERSAL_TARGET = "DRAFT";

/**
 * REVERSE — pull an invoice back to editable without starting a new one.
 *
 * The two corrections are deliberately different actions:
 *
 *   VOID    — this invoice is finished with. Issue a NEW one; the work on it
 *             goes back in the pot unpaid, which is why voiding releases the
 *             shopping and maintenance stamps.
 *   REVERSE — the invoice is fine, its CONTENT is wrong. It returns to DRAFT
 *             keeping its number, its lines and its payment history, and it
 *             releases nothing: the items stay on this invoice, because this
 *             invoice is still the one that will bill them.
 *
 * Confusing the two is expensive in opposite directions. Reversing when you
 * meant void leaves work attached to an invoice you are about to reissue
 * differently; voiding when you meant reverse burns an invoice number and leaves
 * the client asking why they were sent two.
 *
 * NOT REVERSIBLE FROM DRAFT: it is already editable, so there is nothing to
 * undo and the action would only add a no-op audit row.
 *
 * NOT REVERSIBLE FROM VOID: a void has already released its items, and pulling
 * the invoice back to DRAFT would let it re-bill work another invoice may have
 * picked up in the meantime — the same charge alive on two invoices.
 */
export function canReverseInvoice(from: string): boolean {
  return from === "APPROVED" || from === "SENT" || from === "PART_PAID" || from === "PAID";
}

/** Why a reversal was refused, in words an admin can act on. */
export function reverseRefusalReason(from: string): string | null {
  if (canReverseInvoice(from)) return null;
  if (from === "DRAFT") return "This invoice is already a draft — edit it directly.";
  if (from === "VOID") {
    return "A void invoice cannot be reversed. Its work has already been released, so generate a replacement instead.";
  }
  return "This invoice cannot be reversed.";
}
