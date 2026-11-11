/**
 * What a Xero read means for one local invoice or credit note. Pure: the sync
 * service reads Xero and the database, asks this module what to do, and does
 * exactly that.
 *
 * Owner decision (2026-11-11): a payment seen in Xero marks the invoice paid
 * automatically, through the existing payment path, only when Xero reports
 * it. Everything that does not line up is left alone and marked for review:
 *
 *  - Xero says VOIDED or DELETED: never voided here automatically.
 *  - Totals differ: lines are never edited to match.
 *  - Xero applied an overpayment, prepayment or credits sNeek does not have.
 *  - A payment recorded from Xero is no longer in Xero: never reversed here.
 *  - Recording Xero's new payments would take payments plus credits past the
 *    total (for example a manual payment here AND the same money in Xero).
 *  - Xero says paid but what sNeek can record does not settle it.
 *
 * A locally PAID or VOID invoice is never touched (the service does not select
 * them, and the payment path refuses them); nothing here can reopen one.
 */
import type { XeroDocument, XeroPayment } from "@/lib/xero/xero-documents";

/** Stored on ClientInvoice.metadata.xeroSync.state. */
export type XeroSyncState = "IN_XERO" | "PAID_IN_XERO" | "NEEDS_REVIEW" | "UNKNOWN";

/** Money compares to the cent; below half a cent is rounding. */
const CENT = 0.005;

export type LocalSyncFacts = {
  kind: "INVOICE" | "CREDIT_NOTE";
  status: string;
  /** Stored total; negative on a credit note. */
  totalAmount: number;
  /** Cumulative payments recorded locally (any source). */
  paidAmount: number;
  /** Approved/sent credit notes against this invoice (positive). */
  creditedAmount: number;
  /** Xero payment ids already in metadata.payments[]. */
  recordedXeroPaymentIds: ReadonlySet<string>;
};

export type SyncDecision =
  | { action: "review"; reason: string; xeroStatus: string }
  | { action: "record"; payments: XeroPayment[]; xeroStatus: string }
  | { action: "settled"; state: "IN_XERO" | "PAID_IN_XERO"; xeroStatus: string };

const aud = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);

function livePayments(document: XeroDocument): XeroPayment[] {
  return document.payments.filter((payment) => payment.status !== "DELETED");
}

/** Every rule above, in order; the first that applies decides. */
export function decideXeroSync(local: LocalSyncFacts, document: XeroDocument): SyncDecision {
  const xeroStatus = document.status;
  const review = (reason: string): SyncDecision => ({ action: "review", reason, xeroStatus });

  if (xeroStatus === "VOIDED" || xeroStatus === "DELETED") {
    return review(`Xero shows this ${local.kind === "CREDIT_NOTE" ? "credit note" : "invoice"} as ${xeroStatus.toLowerCase()}. Nothing was changed here.`);
  }
  const localTotal = Math.abs(local.totalAmount);
  if (Math.abs(document.total - localTotal) > CENT) {
    return review(`Totals differ: Xero ${aud(document.total)}, sNeek ${aud(localTotal)}.`);
  }

  // A credit note is never paid here: its approved/sent amount already reduces
  // its invoice. The pull only confirms Xero agrees it exists and matches.
  if (local.kind === "CREDIT_NOTE") return { action: "settled", state: "IN_XERO", xeroStatus };

  if (document.hasOverOrPrepayments) {
    return review("Xero settled part of this invoice with an overpayment or prepayment, which cannot be recorded here.");
  }
  if (document.amountCredited > local.creditedAmount + CENT) {
    return review(`Xero shows ${aud(document.amountCredited)} credited, sNeek ${aud(local.creditedAmount)}.`);
  }

  const live = livePayments(document);
  const liveIds = new Set(live.map((payment) => payment.paymentId));
  const vanished = Array.from(local.recordedXeroPaymentIds).filter((id) => !liveIds.has(id));
  if (vanished.length > 0) {
    return review("A payment recorded from Xero is no longer in Xero (deleted or reversed there). Nothing was reversed here.");
  }
  if (live.some((payment) => payment.amount <= 0)) {
    return review("Xero lists a payment of zero or less, which cannot be recorded here.");
  }

  const fresh = live
    .filter((payment) => !local.recordedXeroPaymentIds.has(payment.paymentId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.paymentId.localeCompare(b.paymentId));
  const freshTotal = fresh.reduce((sum, payment) => sum + payment.amount, 0);
  if (local.paidAmount + freshTotal + local.creditedAmount > localTotal + CENT) {
    return review(
      `Recording Xero's payments (${aud(freshTotal)}) would exceed the total: sNeek already has ${aud(local.paidAmount)} paid and ${aud(local.creditedAmount)} credited.`,
    );
  }
  if (fresh.length > 0) return { action: "record", payments: fresh, xeroStatus };

  const settledHere = local.paidAmount + local.creditedAmount + CENT >= localTotal;
  if (xeroStatus === "PAID" && !settledHere) {
    return review("Xero says this invoice is paid, but the payments it reports do not settle it here.");
  }
  return { action: "settled", state: xeroStatus === "PAID" ? "PAID_IN_XERO" : "IN_XERO", xeroStatus };
}

/** The xeroSync object stored in ClientInvoice.metadata. */
export type StoredXeroSync = {
  state: XeroSyncState;
  /** Why it needs review or is unknown; null otherwise. */
  reason: string | null;
  /** Xero's own status at the last successful read (kept through unknown reads). */
  xeroStatus: string | null;
  /** When this invoice was last checked, successfully or not. */
  checkedAt: string;
  /** When Xero was last read successfully for this invoice. */
  lastReadAt: string | null;
  /** Figures from the last successful read. */
  xeroTotal: number | null;
  xeroAmountDue: number | null;
  xeroAmountPaid: number | null;
  /** Payments recorded from Xero in the check that wrote this row. */
  recordedPayments: number;
};

/** Reads metadata.xeroSync, or null when absent or malformed. */
export function readStoredXeroSync(metadata: unknown): StoredXeroSync | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).xeroSync;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const sync = raw as Partial<StoredXeroSync>;
  const states: XeroSyncState[] = ["IN_XERO", "PAID_IN_XERO", "NEEDS_REVIEW", "UNKNOWN"];
  if (!sync.state || !states.includes(sync.state) || typeof sync.checkedAt !== "string") return null;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return {
    state: sync.state,
    reason: typeof sync.reason === "string" ? sync.reason : null,
    xeroStatus: typeof sync.xeroStatus === "string" ? sync.xeroStatus : null,
    checkedAt: sync.checkedAt,
    lastReadAt: typeof sync.lastReadAt === "string" ? sync.lastReadAt : null,
    xeroTotal: num(sync.xeroTotal),
    xeroAmountDue: num(sync.xeroAmountDue),
    xeroAmountPaid: num(sync.xeroAmountPaid),
    recordedPayments: num(sync.recordedPayments) ?? 0,
  };
}

/** The state after a successful read. */
export function syncedState(input: {
  state: XeroSyncState;
  reason: string | null;
  document: XeroDocument;
  now: Date;
  recordedPayments: number;
}): StoredXeroSync {
  return {
    state: input.state,
    reason: input.reason,
    xeroStatus: input.document.status,
    checkedAt: input.now.toISOString(),
    lastReadAt: input.now.toISOString(),
    xeroTotal: input.document.total,
    xeroAmountDue: input.document.amountDue,
    xeroAmountPaid: input.document.amountPaid,
    recordedPayments: input.recordedPayments,
  };
}

/**
 * The state after a failed, missing, rate-limited or unparseable read: UNKNOWN
 * with the reason. The last good figures are kept and labelled as such by the
 * screen; nothing about the invoice itself changes.
 */
export function unknownState(previous: StoredXeroSync | null, reason: string, now: Date): StoredXeroSync {
  return {
    state: "UNKNOWN",
    reason,
    xeroStatus: previous?.xeroStatus ?? null,
    checkedAt: now.toISOString(),
    lastReadAt: previous?.lastReadAt ?? null,
    xeroTotal: previous?.xeroTotal ?? null,
    xeroAmountDue: previous?.xeroAmountDue ?? null,
    xeroAmountPaid: previous?.xeroAmountPaid ?? null,
    recordedPayments: 0,
  };
}

/** Xero payment ids already recorded in a metadata.payments[] ledger. */
export function recordedXeroPaymentIds(metadata: unknown): Set<string> {
  const ids = new Set<string>();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return ids;
  const ledger = (metadata as Record<string, unknown>).payments;
  if (!Array.isArray(ledger)) return ids;
  for (const entry of ledger) {
    if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).xeroPaymentId === "string") {
      ids.add((entry as Record<string, string>).xeroPaymentId);
    }
  }
  return ids;
}
