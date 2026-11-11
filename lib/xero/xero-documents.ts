/**
 * Typed reading of Xero invoice (ACCREC) and credit note (ACCRECCREDIT)
 * responses. Pure: no I/O, so every parsing rule is testable without Xero.
 *
 * Anything that cannot be read with confidence is reported as unparseable,
 * never filled in: a missing total is not zero, a missing payment amount is not
 * zero, and a missing status is not "AUTHORISED".
 */

/** One payment Xero applied to an invoice. */
export type XeroPayment = {
  paymentId: string;
  /** The payment date as a calendar day (yyyy-MM-dd), as Xero records it. */
  date: string;
  amount: number;
  /** Xero payment status (AUTHORISED, DELETED); null when Xero omits it. */
  status: string | null;
  reference: string | null;
};

export type XeroDocumentKind = "ACCREC" | "ACCRECCREDIT";

/** The parts of a Xero invoice or credit note the status pull relies on. */
export type XeroDocument = {
  id: string;
  kind: XeroDocumentKind;
  /** DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED. */
  status: string;
  total: number;
  amountDue: number;
  amountPaid: number;
  amountCredited: number;
  /** Payments only; credit-note, overpayment and prepayment allocations are separate. */
  payments: XeroPayment[];
  /** Xero settled part of it with an overpayment or prepayment allocation. */
  hasOverOrPrepayments: boolean;
  updatedAt: string | null;
};

export type XeroReadFailureKind = "not-connected" | "rate-limited" | "http" | "network" | "unparseable" | "missing";

export type XeroReadFailure = { kind: XeroReadFailureKind; reason: string };

/** Per requested id: the document, or why it could not be read. */
export type XeroDocumentRead = { ok: true; document: XeroDocument } | { ok: false; failure: XeroReadFailure };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Xero's JSON dates come as "/Date(1573755038314+0000)/" (milliseconds since
 * the epoch); some fields also come as ISO strings. Returns null when neither.
 */
export function parseXeroDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const legacy = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value.trim());
  if (legacy) {
    const date = new Date(Number(legacy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = /^\d{4}-\d{2}-\d{2}(T[\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$/.test(value.trim()) ? new Date(value.trim()) : null;
  if (!iso || Number.isNaN(iso.getTime())) return null;
  return iso;
}

/** Xero dates without a time are midnight UTC of the calendar day. */
function calendarDay(value: unknown): string | null {
  const date = parseXeroDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

function parsePayment(raw: unknown): XeroPayment | null {
  if (!isObject(raw)) return null;
  const paymentId = text(raw.PaymentID);
  const amount = finiteNumber(raw.Amount);
  const date = calendarDay(raw.Date);
  if (!paymentId || amount === null || !date) return null;
  return { paymentId, amount, date, status: text(raw.Status), reference: text(raw.Reference) };
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Parse one Invoice or CreditNote object. Returns a failure naming the first
 * field that could not be read.
 */
export function parseXeroDocument(raw: unknown, kind: XeroDocumentKind): XeroDocumentRead {
  const unparseable = (reason: string): XeroDocumentRead => ({ ok: false, failure: { kind: "unparseable", reason } });
  if (!isObject(raw)) return unparseable("Xero returned something that is not a document.");
  const id = text(kind === "ACCREC" ? raw.InvoiceID : raw.CreditNoteID);
  if (!id) return unparseable("Xero returned a document without an id.");
  const status = text(raw.Status);
  if (!status) return unparseable("Xero did not say what state the document is in.");
  const total = finiteNumber(raw.Total);
  if (total === null) return unparseable("Xero did not return the document total.");
  // Credit notes report RemainingCredit instead of AmountDue.
  const amountDue = finiteNumber(kind === "ACCREC" ? raw.AmountDue : raw.RemainingCredit);
  if (amountDue === null) return unparseable(kind === "ACCREC" ? "Xero did not return the amount due." : "Xero did not return the remaining credit.");
  // AmountPaid / AmountCredited are absent on documents with nothing applied;
  // their absence is read as nothing applied only when the matching lists are
  // absent or empty too, so a figure is never invented over evidence.
  const rawPayments = raw.Payments;
  if (rawPayments !== undefined && !Array.isArray(rawPayments)) return unparseable("Xero returned payments in an unexpected shape.");
  const payments: XeroPayment[] = [];
  for (const entry of (rawPayments as unknown[] | undefined) ?? []) {
    const payment = parsePayment(entry);
    if (!payment) return unparseable("Xero returned a payment without an id, date or amount.");
    payments.push(payment);
  }
  const amountPaid = finiteNumber(raw.AmountPaid) ?? (payments.length === 0 ? 0 : null);
  if (amountPaid === null) return unparseable("Xero listed payments but no amount paid.");
  const amountCredited = finiteNumber(raw.AmountCredited) ?? (nonEmptyArray(raw.CreditNotes) ? null : 0);
  if (amountCredited === null) return unparseable("Xero listed credit allocations but no amount credited.");
  const updatedAt = parseXeroDate(raw.UpdatedDateUTC);
  return {
    ok: true,
    document: {
      id,
      kind,
      status: status.toUpperCase(),
      total,
      amountDue,
      amountPaid,
      amountCredited,
      payments,
      hasOverOrPrepayments: nonEmptyArray(raw.Overpayments) || nonEmptyArray(raw.Prepayments),
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
    },
  };
}

/**
 * Match a batch response to the ids asked for. An id Xero did not return is
 * "missing" (Xero returns voided and deleted documents with that status, so
 * absence is not a deletion), and the caller records it as unknown.
 */
export function matchXeroDocuments(
  requestedIds: readonly string[],
  rawList: unknown,
  kind: XeroDocumentKind,
): Map<string, XeroDocumentRead> {
  const reads = new Map<string, XeroDocumentRead>();
  if (!Array.isArray(rawList)) {
    for (const id of requestedIds) {
      reads.set(id, { ok: false, failure: { kind: "unparseable", reason: "Xero returned an unexpected response." } });
    }
    return reads;
  }
  const byId = new Map<string, XeroDocumentRead>();
  for (const raw of rawList) {
    const parsed = parseXeroDocument(raw, kind);
    const rawId = isObject(raw) ? text(kind === "ACCREC" ? raw.InvoiceID : raw.CreditNoteID) : null;
    if (rawId) byId.set(rawId.toLowerCase(), parsed);
  }
  for (const id of requestedIds) {
    reads.set(
      id,
      byId.get(id.toLowerCase()) ?? { ok: false, failure: { kind: "missing", reason: "Xero did not return this document." } },
    );
  }
  return reads;
}
