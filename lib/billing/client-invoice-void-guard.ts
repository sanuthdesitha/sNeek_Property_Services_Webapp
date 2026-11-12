/**
 * VOID AND CREDIT NOTES ARE A SENSITIVE ACTION (owner decision 2026-11-13).
 *
 * Every route that voids an invoice (PATCH status VOID, which also voids a
 * credit note) or creates a credit note calls this AFTER its live session
 * guard and the `invoices.void_credit` capability check:
 *   - the capability is tier "full": Finance at Full, or the explicit
 *     sensitive grant (administrators always have it);
 *   - the acting person's own PIN, verified on the server with
 *     `verifySensitiveAction(…, "invoices.void_credit")`; administrators are
 *     asked for their PIN exactly as on the other sensitive actions;
 *   - never while testing as someone (the credential would belong to the
 *     target): refused 403 before any credential is read.
 * There is no bulk void or bulk credit note (CLIENT_INVOICE_BULK_ACTIONS).
 */
import { securitySchema, verifyInvoiceSecurity } from "./client-invoice-patch-rules";
import type { InvoiceActionResult, InvoiceActor } from "./invoice-action-result";

export const VOID_CREDIT_ACTION = "invoices.void_credit" as const;

/** Does this PATCH body void the document (an invoice or a credit note)? */
export function patchVoids(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { status?: unknown }).status === "VOID");
}

/** The `security` object of a request body, or undefined when absent or malformed. */
export function requestSecurity(body: unknown): { pin?: string; password?: string; newPin?: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const parsed = securitySchema.safeParse((body as { security?: unknown }).security);
  return parsed.success ? parsed.data : undefined;
}

/** null when the person's own PIN confirms a void or credit note; otherwise the refusal to answer with. */
export async function voidCreditSecurityRefusal(actor: InvoiceActor, body: unknown): Promise<InvoiceActionResult | null> {
  return verifyInvoiceSecurity(actor, requestSecurity(body), VOID_CREDIT_ACTION);
}
