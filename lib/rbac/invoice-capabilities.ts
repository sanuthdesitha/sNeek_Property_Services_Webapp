/**
 * Which invoice capabilities a client-invoice request needs (pure). Read by
 * the invoice routes before the shared action runs; the action's own
 * guards (row lock, stale check, issued-record protection) still apply.
 */
import type { ClientInvoiceBulkAction } from "@/lib/billing/client-invoice-list-types";
import type { CapabilityKey } from "./capabilities";

type PatchShape = { status?: unknown; recordPayment?: unknown };

export function invoicePatchCapabilities(body: unknown): CapabilityKey[] {
  if (!body || typeof body !== "object") return [];
  const patch = body as PatchShape;
  const needed: CapabilityKey[] = [];
  if (patch.status === "APPROVED") needed.push("invoices.approve");
  if (patch.status === "SENT") needed.push("invoices.send");
  if (patch.status === "PAID" || patch.status === "PART_PAID" || patch.recordPayment !== undefined) needed.push("invoices.record_payment");
  if (patch.status === "VOID") needed.push("invoices.void_credit");
  return needed;
}

export function invoiceBulkCapabilities(action: ClientInvoiceBulkAction): CapabilityKey[] {
  switch (action) {
    case "approve":
      return ["invoices.approve"];
    case "send":
      return ["invoices.send"];
    case "approve-and-send":
      return ["invoices.approve", "invoices.send"];
    case "xero-push":
      return [];
  }
}
