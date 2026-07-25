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
