/**
 * "Update in Xero" rules, as pure functions so every refusal is testable
 * without Xero.
 *
 * WHEN XERO LETS AN EXISTING DOCUMENT CHANGE. From the Xero Accounting API
 * (POST /Invoices/{InvoiceID} and POST /CreditNotes/{CreditNoteID} update the
 * document with that id; PUT creates) and Xero's own refusals ("Invoice not of
 * valid status for modification", "This document cannot be edited as it has a
 * payment or credit note allocated to it"):
 *   - DRAFT and SUBMITTED: lines can be changed.
 *   - AUTHORISED: only while nothing is applied to it — no payment, no credit
 *     note, overpayment or prepayment allocation.
 *   - PAID, VOIDED, DELETED: never.
 * Xero can still refuse for reasons read only at the time (a locked period,
 * a tax rate); that refusal is shown in Xero's words and nothing changes here.
 *
 * Any other status, or a figure that could not be read, is a refusal: an
 * unknown is never treated as "safe to overwrite".
 */
import type { XeroDocument, XeroLineSnapshot } from "@/lib/xero/xero-documents";

export type XeroUpdateEligibility = { ok: true } | { ok: false; reason: string };

function money(value: number): string {
  return `$${Math.abs(value).toFixed(2)}`;
}

/** Whether Xero allows this document's lines to be replaced, from its status and what is applied to it. */
export function xeroUpdateEligibility(document: XeroDocument): XeroUpdateEligibility {
  const name = document.kind === "ACCRECCREDIT" ? "credit note" : "invoice";
  switch (document.status) {
    case "VOIDED":
      return { ok: false, reason: `Xero shows this ${name} as voided. Xero does not allow a voided ${name} to be changed.` };
    case "DELETED":
      return { ok: false, reason: `Xero shows this ${name} as deleted. Xero does not allow a deleted ${name} to be changed.` };
    case "PAID":
      return {
        ok: false,
        reason: document.kind === "ACCRECCREDIT"
          ? "Xero shows this credit note as fully allocated or refunded. Xero does not allow it to be changed."
          : "Xero shows this invoice as paid. Xero does not allow a paid invoice to be changed.",
      };
    case "DRAFT":
    case "SUBMITTED":
    case "AUTHORISED":
      break;
    default:
      return { ok: false, reason: `Xero reported the status "${document.status}", which this app does not update. Nothing was changed.` };
  }
  if (document.kind === "ACCREC") {
    if (document.amountPaid > 0 || document.payments.length > 0) {
      return { ok: false, reason: `Xero has ${money(document.amountPaid)} paid on this invoice. Xero does not allow an invoice with a payment to be changed; leave it as it is, or remove the payment in Xero first.` };
    }
    if (document.amountCredited > 0) {
      return { ok: false, reason: `Xero has ${money(document.amountCredited)} of credit allocated to this invoice. Xero does not allow it to be changed while a credit note is allocated.` };
    }
  } else if (document.amountDue < document.total) {
    // A credit note's AmountDue is its RemainingCredit: less than its total means some was allocated or refunded.
    return { ok: false, reason: `Xero has ${money(document.total - document.amountDue)} of this credit note allocated or refunded. Xero does not allow it to be changed.` };
  }
  if (document.hasOverOrPrepayments) {
    return { ok: false, reason: `Xero has an overpayment or prepayment allocated to this ${name}. Xero does not allow it to be changed.` };
  }
  return { ok: true };
}

/** Rounded to the cent, for comparing totals. */
export function cents(value: number): number {
  return Math.round(Math.abs(value) * 100);
}

/** What the update would change in Xero, from the lines Xero holds and the lines it would send. */
export type XeroLineChange = "none" | "order-only" | "descriptions" | "amounts" | "unknown";

type ComparableLine = { description: string; quantity: number; unitAmount: number };

function amountKey(line: ComparableLine): string {
  return `${Math.round(line.quantity * 10_000)}|${Math.round(line.unitAmount * 10_000)}`;
}

function fullKey(line: ComparableLine): string {
  return `${amountKey(line)}|${line.description.trim().replace(/\s+/g, " ")}`;
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Compare Xero's lines with the lines about to be sent (both in Xero's sign,
 * so a credit note's amounts are positive on both sides). "amounts" means a
 * quantity or unit amount differs, or a line was added or removed.
 */
export function compareXeroLines(inXero: readonly XeroLineSnapshot[] | null | undefined, outgoing: readonly ComparableLine[]): XeroLineChange {
  if (!inXero) return "unknown";
  const xeroFull = inXero.map(fullKey);
  const outFull = outgoing.map(fullKey);
  if (xeroFull.length === outFull.length && xeroFull.every((key, index) => key === outFull[index])) return "none";
  if (sameMultiset(xeroFull, outFull)) return "order-only";
  if (sameMultiset(inXero.map(amountKey), outgoing.map(amountKey))) return "descriptions";
  return "amounts";
}

/** Plain words for the change, for the confirmation, the result and History. */
export const XERO_LINE_CHANGE_LABEL: Record<XeroLineChange, string> = {
  none: "Xero already lists these lines in this order",
  "order-only": "line order only",
  descriptions: "line order and descriptions",
  amounts: "line amounts differ from Xero",
  unknown: "Xero did not return its lines, so the change could not be compared",
};

/** The figures shown when the totals differ; the confirmation must repeat them. */
export type XeroTotalsConfirmation = { localTotal: number; xeroTotal: number };

/**
 * Whether the person must confirm overwriting Xero: its total differs from this
 * invoice's, or its line amounts differ. A confirmation counts only when it
 * names the same two totals the server sees now, so a stale dialog never
 * authorises a different overwrite.
 */
export function needsOverwriteConfirmation(input: {
  localTotal: number;
  xeroTotal: number;
  change: XeroLineChange;
  confirmed?: XeroTotalsConfirmation | null;
}): boolean {
  const totalsDiffer = cents(input.localTotal) !== cents(input.xeroTotal);
  if (!totalsDiffer && input.change !== "amounts") return false;
  const confirmed = input.confirmed;
  if (!confirmed) return true;
  return cents(confirmed.localTotal) !== cents(input.localTotal) || cents(confirmed.xeroTotal) !== cents(input.xeroTotal);
}

/* ── The stored state of the last "Update in Xero" (invoice metadata.xeroUpdate) ── */

export type XeroUpdateState = "PENDING" | "FAILED" | "DONE";

/**
 * Kept on the invoice's metadata. PENDING while a request is with Xero (it
 * blocks a second update and an order change meanwhile), FAILED with Xero's
 * sanitised reason, DONE once Xero confirmed the same document id. The
 * invoice's xeroInvoiceId and push state are never touched by any of these.
 */
export type StoredXeroUpdate = {
  state: XeroUpdateState;
  /** The request key of the attempt (one per confirmation dialog), for double-click idempotency. */
  key: string;
  at: string;
  reason: string | null;
  /** When Xero last confirmed an update, kept across later failures. */
  lastSuccessAt: string | null;
  change: XeroLineChange | null;
  xeroStatusBefore: string | null;
};

/** A PENDING update older than this was cut off (a restart); a new attempt may start. */
export const XERO_UPDATE_PENDING_TTL_MS = 2 * 60_000;

const CHANGES: ReadonlySet<string> = new Set(["none", "order-only", "descriptions", "amounts", "unknown"]);

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function readStoredXeroUpdate(metadata: unknown): StoredXeroUpdate | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).xeroUpdate;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  const state = entry.state === "PENDING" || entry.state === "FAILED" || entry.state === "DONE" ? entry.state : null;
  const key = textOrNull(entry.key);
  const at = textOrNull(entry.at);
  if (!state || !key || !at) return null;
  return {
    state,
    key,
    at,
    reason: textOrNull(entry.reason),
    lastSuccessAt: textOrNull(entry.lastSuccessAt),
    change: typeof entry.change === "string" && CHANGES.has(entry.change) ? (entry.change as XeroLineChange) : null,
    xeroStatusBefore: textOrNull(entry.xeroStatusBefore),
  };
}

/** True while an update is with Xero (and not yet stale). */
export function xeroUpdateInFlight(metadata: unknown, now: Date = new Date()): boolean {
  const stored = readStoredXeroUpdate(metadata);
  if (!stored || stored.state !== "PENDING") return false;
  const started = new Date(stored.at).getTime();
  return Number.isFinite(started) && now.getTime() - started < XERO_UPDATE_PENDING_TTL_MS;
}

export const XERO_UPDATE_IN_FLIGHT_REFUSAL = "An update to Xero is running for this invoice. Wait for it to finish, then try again.";

/* ── Whether "Update in Xero" is offered, before Xero is asked ── */

export type XeroUpdateFacts = {
  status: string;
  kind?: string | null;
  xeroInvoiceId: string | null;
  paidAt: Date | string | null;
  paidAmount: number | null;
};

export type XeroUpdateAvailability = { available: true } | { available: false; reason: string };

/**
 * Offered only for a document already in Xero that is not void, paid or
 * part-paid here (Xero refuses a document with a payment). Xero's own status
 * is checked again when the action runs; this is what the screen can tell
 * without asking Xero.
 */
export function xeroUpdateAvailability(facts: XeroUpdateFacts, canManage = true): XeroUpdateAvailability {
  if (!facts.xeroInvoiceId) return { available: false, reason: "Not in Xero yet. Push it to Xero first." };
  if (facts.status === "VOID") return { available: false, reason: "Void here, so it is not updated in Xero." };
  const creditNote = facts.kind === "CREDIT_NOTE";
  if (!creditNote && (facts.status === "PAID" || facts.status === "PART_PAID" || facts.paidAt || Number(facts.paidAmount ?? 0) > 0)) {
    return { available: false, reason: "A payment is recorded on this invoice, and Xero does not allow an invoice with a payment to be changed." };
  }
  if (!canManage) return { available: false, reason: "Your access to invoices is view only." };
  return { available: true };
}
