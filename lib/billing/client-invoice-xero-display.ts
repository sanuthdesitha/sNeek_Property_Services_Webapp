/**
 * The words and tone for an invoice's Xero state, shared by the list's Xero
 * column, the editor's Xero card and the CSV: Not in Xero / Push pending /
 * In Xero · last checked {time} / Paid in Xero (recorded) / Needs review:
 * {reason} / State unknown: {reason}. Pure; safe in client components.
 */
import type { ClientInvoiceListRow } from "./client-invoice-list-types";

export type XeroDisplayKey = "none" | "pending" | "unchecked" | "in-xero" | "paid-in-xero" | "needs-review" | "unknown";

export type XeroDisplay = {
  key: XeroDisplayKey;
  label: string;
  tone: "neutral" | "ok" | "warn" | "bad" | "info";
  /** The reason (review/unknown) or null. */
  reason: string | null;
  /** When the pull last checked it (ISO), or null when never checked. */
  checkedAt: string | null;
};

export type XeroDisplayFacts = Pick<ClientInvoiceListRow, "xeroInvoiceId" | "xeroExportedAt" | "xeroState"> &
  Partial<Pick<ClientInvoiceListRow, "xeroSync">>;

export function xeroDisplay(facts: XeroDisplayFacts): XeroDisplay {
  if (facts.xeroState === "PENDING") return { key: "pending", label: "Push pending", tone: "bad", reason: "Pending or failed: retry the push.", checkedAt: null };
  if (facts.xeroState !== "PUSHED") return { key: "none", label: "Not in Xero", tone: "neutral", reason: null, checkedAt: null };
  const sync = facts.xeroSync ?? null;
  if (!sync) return { key: "unchecked", label: "In Xero", tone: "ok", reason: "Not checked against Xero yet.", checkedAt: null };
  switch (sync.state) {
    case "PAID_IN_XERO":
      return { key: "paid-in-xero", label: "Paid in Xero (recorded)", tone: "ok", reason: null, checkedAt: sync.checkedAt };
    case "NEEDS_REVIEW":
      return { key: "needs-review", label: "Needs review", tone: "warn", reason: sync.reason, checkedAt: sync.checkedAt };
    case "UNKNOWN":
      return { key: "unknown", label: "State unknown", tone: "bad", reason: sync.reason, checkedAt: sync.checkedAt };
    default:
      return { key: "in-xero", label: "In Xero", tone: "ok", reason: null, checkedAt: sync.checkedAt };
  }
}
