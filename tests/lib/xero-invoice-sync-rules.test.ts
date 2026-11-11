// @vitest-environment node
/**
 * Money step (d): parsing Xero documents and the pure rules that decide what a
 * Xero read means for a local invoice. Mocked data only; nothing here talks to
 * real Xero.
 */
import { describe, expect, it } from "vitest";
import { matchXeroDocuments, parseXeroDate, parseXeroDocument, type XeroDocument } from "@/lib/xero/xero-documents";
import {
  decideXeroSync,
  readStoredXeroSync,
  recordedXeroPaymentIds,
  unknownState,
  type LocalSyncFacts,
} from "@/lib/billing/client-invoice-xero-sync-rules";

const rawInvoice = (extra: Record<string, unknown> = {}) => ({
  InvoiceID: "x-1",
  Status: "AUTHORISED",
  Total: 110,
  AmountDue: 60,
  AmountPaid: 50,
  AmountCredited: 0,
  UpdatedDateUTC: "/Date(1762819200000+0000)/",
  Payments: [{ PaymentID: "p-1", Date: "/Date(1762732800000+0000)/", Amount: 50, Status: "AUTHORISED" }],
  ...extra,
});

describe("parsing Xero documents", () => {
  it("reads Xero's /Date()/ and ISO dates, and refuses garbage", () => {
    expect(parseXeroDate("/Date(1762732800000+0000)/")?.toISOString()).toBe("2025-11-10T00:00:00.000Z");
    expect(parseXeroDate("2026-11-10T00:00:00")).toBeInstanceOf(Date);
    expect(parseXeroDate("yesterday")).toBeNull();
    expect(parseXeroDate(undefined)).toBeNull();
  });

  it("parses an invoice with its payments", () => {
    const read = parseXeroDocument(rawInvoice(), "ACCREC");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.document).toMatchObject({ id: "x-1", status: "AUTHORISED", total: 110, amountDue: 60, amountPaid: 50, hasOverOrPrepayments: false });
    expect(read.document.payments).toEqual([{ paymentId: "p-1", date: "2025-11-10", amount: 50, status: "AUTHORISED", reference: null }]);
  });

  it.each([
    [{ Total: undefined }, "total"],
    [{ Status: undefined }, "state"],
    [{ AmountDue: "60" }, "amount due"],
    [{ Payments: [{ PaymentID: "p", Date: "/Date(1)/" }] }, "payment"],
    [{ AmountPaid: undefined }, "amount paid"],
    [{ Payments: "nope" }, "unexpected shape"],
  ])("never fills in a missing figure: %j", (patch, words) => {
    const read = parseXeroDocument(rawInvoice(patch), "ACCREC");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.failure.kind).toBe("unparseable"), expect(read.failure.reason.toLowerCase()).toContain(words);
  });

  it("reads a credit note's remaining credit as its amount due", () => {
    const read = parseXeroDocument({ CreditNoteID: "c-1", Status: "PAID", Total: 20, RemainingCredit: 0 }, "ACCRECCREDIT");
    expect(read.ok && read.document).toMatchObject({ kind: "ACCRECCREDIT", amountDue: 0, amountPaid: 0, status: "PAID" });
  });

  it("matches a batch to the ids asked for; an id not returned is missing, not deleted", () => {
    const reads = matchXeroDocuments(["X-1", "x-2"], [rawInvoice()], "ACCREC");
    expect(reads.get("X-1")?.ok).toBe(true);
    expect(reads.get("x-2")).toEqual({ ok: false, failure: { kind: "missing", reason: "Xero did not return this document." } });
    expect(matchXeroDocuments(["a"], undefined, "ACCREC").get("a")?.ok).toBe(false);
  });
});

const doc = (extra: Partial<XeroDocument> = {}): XeroDocument => ({
  id: "x-1", kind: "ACCREC", status: "AUTHORISED", total: 110, amountDue: 110, amountPaid: 0, amountCredited: 0,
  payments: [], hasOverOrPrepayments: false, updatedAt: null, ...extra,
});
const local = (extra: Partial<LocalSyncFacts> = {}): LocalSyncFacts => ({
  kind: "INVOICE", status: "SENT", totalAmount: 110, paidAmount: 0, creditedAmount: 0, recordedXeroPaymentIds: new Set(), ...extra,
});
const pay = (paymentId: string, amount: number, date = "2026-11-10") => ({ paymentId, amount, date, status: "AUTHORISED", reference: null });

describe("what a Xero read means", () => {
  it.each(["VOIDED", "DELETED"])("never voids automatically when Xero says %s", (status) => {
    expect(decideXeroSync(local(), doc({ status }))).toMatchObject({ action: "review", reason: expect.stringContaining(status.toLowerCase()) });
  });

  it("flags differing totals instead of editing lines", () => {
    expect(decideXeroSync(local(), doc({ total: 120 }))).toMatchObject({ action: "review", reason: expect.stringContaining("Totals differ") });
  });

  it("records new payments, oldest first", () => {
    const decision = decideXeroSync(local(), doc({ payments: [pay("b", 10, "2026-11-09"), pay("a", 20, "2026-11-01")] }));
    expect(decision).toMatchObject({ action: "record" });
    if (decision.action === "record") expect(decision.payments.map((p) => p.paymentId)).toEqual(["a", "b"]);
  });

  it("never records a payment id twice (idempotent re-runs)", () => {
    const decision = decideXeroSync(local({ paidAmount: 50, recordedXeroPaymentIds: new Set(["a"]) }), doc({ payments: [pay("a", 50)] }));
    expect(decision).toEqual({ action: "settled", state: "IN_XERO", xeroStatus: "AUTHORISED" });
  });

  it("does not auto-pay when manual payments plus Xero's would exceed the total", () => {
    const decision = decideXeroSync(local({ paidAmount: 110 }), doc({ status: "PAID", payments: [pay("a", 110)] }));
    expect(decision).toMatchObject({ action: "review", reason: expect.stringContaining("exceed") });
  });

  it("flags a payment larger than what is owed", () => {
    expect(decideXeroSync(local({ creditedAmount: 20 }), doc({ payments: [pay("a", 100)] })).action).toBe("review");
  });

  it("flags overpayments, prepayments and credits sNeek does not have", () => {
    expect(decideXeroSync(local(), doc({ hasOverOrPrepayments: true })).action).toBe("review");
    expect(decideXeroSync(local(), doc({ amountCredited: 30 })).action).toBe("review");
    expect(decideXeroSync(local({ creditedAmount: 30 }), doc({ amountCredited: 30 })).action).toBe("settled");
  });

  it("flags a recorded Xero payment that has vanished from Xero, and never reverses it", () => {
    const decision = decideXeroSync(local({ paidAmount: 50, recordedXeroPaymentIds: new Set(["gone"]) }), doc({ payments: [] }));
    expect(decision).toMatchObject({ action: "review", reason: expect.stringContaining("no longer in Xero") });
    expect(decideXeroSync(local({ paidAmount: 50, recordedXeroPaymentIds: new Set(["a"]) }), doc({ payments: [{ ...pay("a", 50), status: "DELETED" }] })).action).toBe("review");
  });

  it("flags Xero PAID when what it reports does not settle the invoice here", () => {
    expect(decideXeroSync(local(), doc({ status: "PAID" })).action).toBe("review");
    expect(decideXeroSync(local({ status: "PAID", paidAmount: 110 }), doc({ status: "PAID" }))).toMatchObject({ action: "settled", state: "PAID_IN_XERO" });
  });

  it("refuses zero or negative payments", () => {
    expect(decideXeroSync(local(), doc({ payments: [pay("a", 0)] })).action).toBe("review");
  });

  it("never pays a credit note; only confirms Xero agrees (positive Xero total vs negative local)", () => {
    const note = local({ kind: "CREDIT_NOTE", totalAmount: -20, status: "SENT" });
    expect(decideXeroSync(note, doc({ kind: "ACCRECCREDIT", total: 20, status: "PAID", payments: [pay("a", 20)] }))).toEqual({ action: "settled", state: "IN_XERO", xeroStatus: "PAID" });
    expect(decideXeroSync(note, doc({ kind: "ACCRECCREDIT", total: 25 })).action).toBe("review");
    expect(decideXeroSync(note, doc({ kind: "ACCRECCREDIT", total: 20, status: "VOIDED" })).action).toBe("review");
  });
});

describe("stored state", () => {
  it("an unknown read keeps the last good figures and says why", () => {
    const now = new Date("2026-11-11T01:00:00Z");
    const previous = readStoredXeroSync({ xeroSync: { state: "IN_XERO", checkedAt: "2026-11-10T00:00:00Z", lastReadAt: "2026-11-10T00:00:00Z", xeroStatus: "AUTHORISED", xeroAmountDue: 60 } });
    const state = unknownState(previous, "Xero state unknown: rate limited", now);
    expect(state).toMatchObject({ state: "UNKNOWN", reason: "Xero state unknown: rate limited", lastReadAt: "2026-11-10T00:00:00Z", xeroAmountDue: 60, xeroStatus: "AUTHORISED", checkedAt: now.toISOString() });
    expect(readStoredXeroSync({ xeroSync: { state: "SYNCED", checkedAt: "x" } })).toBeNull();
  });

  it("reads Xero payment ids from the ledger only", () => {
    expect(recordedXeroPaymentIds({ payments: [{ xeroPaymentId: "a" }, { method: "CASH" }, null] })).toEqual(new Set(["a"]));
    expect(recordedXeroPaymentIds(null).size).toBe(0);
  });
});
