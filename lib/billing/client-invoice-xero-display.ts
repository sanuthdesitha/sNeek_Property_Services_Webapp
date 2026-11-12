/**
 * The words and tone for an invoice's Xero state, shared by the list's Xero
 * column, the filter, the editor's Xero card and the stage bar (Wave D):
 *
 *   Not in Xero              never pushed
 *   Push pending             a push is reserved and in flight (or was cut off
 *                            before it could record anything)
 *   Push failed              the provider refused or could not be reached; the
 *                            sanitised reason and time are stored
 *   In Xero · not yet checked  Xero returned an id; the status pull has never read it
 *   Synced                   in Xero and the last successful read agreed
 *   Synced · paid in Xero    as above, and the Xero payments are recorded here
 *   Needs review: {reason}   read, but something does not match
 *   State unknown: {reason}  the last read failed; nothing was changed
 *
 * Pure; safe in client components.
 */
import type { ClientInvoiceListRow } from "./client-invoice-list-types";

export type XeroDisplayKey = "none" | "pending" | "failed" | "unchecked" | "in-xero" | "paid-in-xero" | "needs-review" | "unknown";

export type XeroDisplay = {
  key: XeroDisplayKey;
  label: string;
  tone: "neutral" | "ok" | "warn" | "bad" | "info";
  /** The reason (failed/review/unknown) or a short explanation, or null. */
  reason: string | null;
  /** When the pull last checked it, or when the push failed (ISO), or null. */
  checkedAt: string | null;
};

export type XeroDisplayFacts = Pick<ClientInvoiceListRow, "xeroInvoiceId" | "xeroExportedAt" | "xeroState"> &
  Partial<Pick<ClientInvoiceListRow, "xeroSync" | "xeroPushFailure">>;

export function xeroDisplay(facts: XeroDisplayFacts): XeroDisplay {
  if (facts.xeroState === "PENDING") {
    const failure = facts.xeroPushFailure ?? null;
    if (failure) return { key: "failed", label: "Push failed", tone: "bad", reason: failure.reason, checkedAt: failure.at || null };
    return { key: "pending", label: "Push pending", tone: "warn", reason: "A push is in progress or was interrupted. Retry is safe: Xero will not create it twice.", checkedAt: null };
  }
  if (facts.xeroState !== "PUSHED") return { key: "none", label: "Not in Xero", tone: "neutral", reason: null, checkedAt: null };
  const sync = facts.xeroSync ?? null;
  if (!sync) return { key: "unchecked", label: "In Xero · not yet checked", tone: "info", reason: null, checkedAt: null };
  switch (sync.state) {
    case "PAID_IN_XERO":
      return { key: "paid-in-xero", label: "Synced · paid in Xero", tone: "ok", reason: null, checkedAt: sync.checkedAt };
    case "NEEDS_REVIEW":
      return { key: "needs-review", label: "Needs review", tone: "warn", reason: sync.reason, checkedAt: sync.checkedAt };
    case "UNKNOWN":
      return { key: "unknown", label: "State unknown", tone: "bad", reason: sync.reason, checkedAt: sync.checkedAt };
    default:
      return { key: "in-xero", label: "Synced", tone: "ok", reason: null, checkedAt: sync.checkedAt };
  }
}
