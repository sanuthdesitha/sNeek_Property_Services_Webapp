/**
 * The invoice PATCH's stale-write guard (Wave D). A caller that read the
 * invoice at `expectedUpdatedAt` may only write while the stored row is still
 * that version; otherwise it gets 409 with the current token and nothing is
 * written, so an autosave racing another tab or a bulk action cannot silently
 * overwrite it. Callers that send no token keep the old behaviour.
 */
import { actionResult, type InvoiceActionResult } from "./invoice-action-result";

export const STALE_INVOICE_CODE = "STALE_INVOICE";
export const STALE_INVOICE_REFUSAL =
  "This invoice was changed somewhere else since you opened it. Reload their version, or keep your edits and try again.";

export function staleInvoiceRefusal(storedUpdatedAt: Date, expectedUpdatedAt: string | undefined): InvoiceActionResult | null {
  if (expectedUpdatedAt === undefined) return null;
  const expected = new Date(expectedUpdatedAt).getTime();
  if (Number.isFinite(expected) && expected === storedUpdatedAt.getTime()) return null;
  return actionResult({ error: STALE_INVOICE_REFUSAL, code: STALE_INVOICE_CODE, currentUpdatedAt: storedUpdatedAt.toISOString() }, 409);
}
