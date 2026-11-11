// @vitest-environment node
/**
 * Money step (c) pure rules: the shared content lock, discounts and their
 * totals, credit-note limits and totals, the owing rule, the PDF pieces, the
 * Xero mapping, the editor's line rules and every consumer of invoice lines
 * that must cope with a negative manual line.
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  ISSUED_CREDIT_NOTE_REFUSAL,
  ISSUED_INVOICE_REFUSAL,
  STARTED_WORK_UNREADABLE_REFUSAL,
  emptyInvoiceRefusal,
  invoiceContentLock,
  invoiceEditLock,
} from "@/lib/billing/client-invoice-guards";
import {
  DISCOUNT_CATEGORY,
  creditNoteSourceRefusal,
  creditNoteTotalRefusal,
  creditableRemaining,
  discountBase,
  invoiceGoesBelowZero,
  negatedLine,
  resolveDiscount,
} from "@/lib/billing/client-invoice-adjustments";
import { calculateShoppingAwareInvoiceTotals } from "@/lib/billing/shopping-client-charges";
import { creditedAmountOf, invoiceAmountOwing, isFullyCredited, summarizeReceivables } from "@/lib/finance/receivables";
import { pdfClientNoteHtml, pdfDocumentTitle, pdfDueLine, pdfHeaderExtrasHtml, pdfMoney } from "@/lib/billing/client-invoice-pdf-parts";
import { invoiceDueDay } from "@/lib/billing/invoice-due";
import { xeroCreditNoteLineItem, xeroInvoiceReference } from "@/lib/billing/client-invoice-xero-mapping";
import { groupInvoiceLines } from "@/lib/billing/invoice-grouping";
import { invoiceOperatingRevenue } from "@/lib/finance/shopping-accounting";
import { availableInvoiceActions, primaryInvoiceAction } from "@/components/v2/admin/finance/invoices/invoice-model";
import { buildLineUpdates, validateNewLine } from "@/components/v2/admin/finance/invoices/editor/line-drafts";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";

const facts = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  xeroInvoiceId: null,
  metadata: null,
  paidAt: null,
  paidAmount: null,
  ...extra,
});

describe("shared content lock (PATCH refusal and editor reason)", () => {
  it.each(["DRAFT", "APPROVED"])("allows content edits on %s", (status) => {
    expect(invoiceContentLock(facts(status))).toEqual({ editable: true });
  });

  it.each(["SENT", "PART_PAID", "PAID"])("locks %s with the credit-note reason, and the editor shows the same words", (status) => {
    const lock = invoiceContentLock(facts(status));
    expect(lock).toEqual({ editable: false, kind: "issued", reason: ISSUED_INVOICE_REFUSAL });
    expect(invoiceEditLock(facts(status), true)).toEqual(lock);
    expect(ISSUED_INVOICE_REFUSAL).toMatch(/credit note/);
  });

  it("locks VOID and a sent credit note with their own reasons", () => {
    expect(invoiceContentLock(facts("VOID"))).toMatchObject({ editable: false, kind: "void" });
    expect(invoiceContentLock(facts("SENT", { kind: "CREDIT_NOTE" }))).toMatchObject({ reason: ISSUED_CREDIT_NOTE_REFUSAL });
  });

  it("keeps an invoice with an unreadable started-work snapshot read only", () => {
    const lock = invoiceContentLock(facts("DRAFT", { metadata: { startedWorkReview: { version: 2 } } }));
    expect(lock).toEqual({ editable: false, kind: "review-unreadable", reason: STARTED_WORK_UNREADABLE_REFUSAL });
  });

  it("refuses approval of a blank draft with no lines", () => {
    expect(emptyInvoiceRefusal({ lines: [] })).toMatch(/no lines/);
    expect(emptyInvoiceRefusal({ lines: [{}] })).toBeNull();
  });
});

describe("discounts", () => {
  const lines = [
    { category: "SERVICE", lineTotal: 200 },
    { category: "SHOPPING_DISBURSEMENT", lineTotal: 50 },
  ];

  it("works out a percentage of the current subtotal and keeps the basis", () => {
    expect(discountBase(lines)).toBe(250);
    expect(resolveDiscount({ percent: 10 }, lines)).toEqual({ ok: true, amount: 25, percent: 10 });
    expect(resolveDiscount({ amount: 12.345 }, lines)).toEqual({ ok: true, amount: 12.35, percent: null });
  });

  it("refuses both, neither, zero and over-100 percentages", () => {
    expect(resolveDiscount({}, lines).ok).toBe(false);
    expect(resolveDiscount({ amount: 5, percent: 5 }, lines).ok).toBe(false);
    expect(resolveDiscount({ percent: 101 }, lines).ok).toBe(false);
    expect(resolveDiscount({ amount: 0 }, lines).ok).toBe(false);
  });

  it("is included by the one totals function: GST on the discounted taxable amount", () => {
    const withDiscount = [...lines, { category: DISCOUNT_CATEGORY, lineTotal: -20 }];
    expect(calculateShoppingAwareInvoiceTotals(withDiscount, true)).toEqual({ subtotal: 230, gstAmount: 18, totalAmount: 248 });
    expect(calculateShoppingAwareInvoiceTotals(withDiscount, false)).toEqual({ subtotal: 230, gstAmount: 0, totalAmount: 230 });
  });

  it("refuses a discount that takes the invoice below zero (taxable lines only)", () => {
    expect(invoiceGoesBelowZero([{ category: "SERVICE", lineTotal: 100 }, { category: DISCOUNT_CATEGORY, lineTotal: -100 }], "INVOICE")).toBe(false);
    expect(invoiceGoesBelowZero([{ category: "SERVICE", lineTotal: 100 }, { category: DISCOUNT_CATEGORY, lineTotal: -100.01 }], "INVOICE")).toBe(true);
    expect(invoiceGoesBelowZero([{ category: "SERVICE", lineTotal: -100 }], "CREDIT_NOTE")).toBe(false);
  });
});

describe("credit notes", () => {
  it("can only credit a sent, part-paid or paid invoice", () => {
    expect(creditNoteSourceRefusal({ kind: "INVOICE", status: "SENT" })).toBeNull();
    expect(creditNoteSourceRefusal({ kind: "INVOICE", status: "PAID" })).toBeNull();
    expect(creditNoteSourceRefusal({ kind: "INVOICE", status: "DRAFT" })).toMatch(/not been sent/);
    expect(creditNoteSourceRefusal({ kind: "INVOICE", status: "APPROVED" })).toMatch(/not been sent/);
    expect(creditNoteSourceRefusal({ kind: "INVOICE", status: "VOID" })).toMatch(/void/);
    expect(creditNoteSourceRefusal({ kind: "CREDIT_NOTE", status: "SENT" })).toMatch(/credit note/);
  });

  it("mirrors the invoice exactly when every line is negated", () => {
    const original = [
      { category: "SERVICE", lineTotal: 165.55, unitPrice: 165.55 },
      { category: "SHOPPING_DISBURSEMENT", lineTotal: 40, unitPrice: 40 },
      { category: DISCOUNT_CATEGORY, lineTotal: -10, unitPrice: -10 },
    ];
    const invoice = calculateShoppingAwareInvoiceTotals(original, true);
    const credit = calculateShoppingAwareInvoiceTotals(original.map(negatedLine), true, { kind: "CREDIT_NOTE" });
    expect(credit).toEqual({ subtotal: -invoice.subtotal, gstAmount: -invoice.gstAmount, totalAmount: -invoice.totalAmount });
    expect(negatedLine({ unitPrice: 0, lineTotal: 0 }).unitPrice).toBe(0);
    expect(Object.is(negatedLine({ unitPrice: 0, lineTotal: 0 }).lineTotal, -0)).toBe(false);
  });

  it("limits a credit to the original total less credits already issued", () => {
    expect(creditableRemaining(220, 100)).toBe(120);
    expect(creditNoteTotalRefusal({ total: -120, remaining: 120, originalNumber: "INV-1", requireCredit: true })).toBeNull();
    expect(creditNoteTotalRefusal({ total: -50, remaining: 120, originalNumber: "INV-1", requireCredit: true })).toBeNull();
    expect(creditNoteTotalRefusal({ total: -120.02, remaining: 120, originalNumber: "INV-1" })).toMatch(/more than INV-1/);
    expect(creditNoteTotalRefusal({ total: 5, remaining: 120, originalNumber: "INV-1" })).toMatch(/cannot add a charge/);
    expect(creditNoteTotalRefusal({ total: 0, remaining: 120, originalNumber: "INV-1", requireCredit: true })).toMatch(/credits nothing/);
  });

  it("lets an over-limit draft shrink, but never grow, until it is within the limit", () => {
    expect(creditNoteTotalRefusal({ total: -200, previousTotal: -220, remaining: 120, originalNumber: "INV-1" })).toBeNull();
    expect(creditNoteTotalRefusal({ total: -230, previousTotal: -220, remaining: 120, originalNumber: "INV-1" })).toMatch(/more than/);
  });
});

describe("what is owed", () => {
  it("counts only approved and sent credit notes, as positive amounts", () => {
    expect(creditedAmountOf([
      { status: "APPROVED", totalAmount: -50 },
      { status: "SENT", totalAmount: -20 },
      { status: "DRAFT", totalAmount: -100 },
      { status: "VOID", totalAmount: -100 },
    ])).toBe(70);
  });

  it("reduces owing by credits and payments, never below zero", () => {
    expect(invoiceAmountOwing({ totalAmount: 220, paidAmount: 50, creditedAmount: 70 })).toBe(100);
    expect(invoiceAmountOwing({ totalAmount: 220, paidAmount: 200, creditedAmount: 70 })).toBe(0);
    expect(invoiceAmountOwing({ totalAmount: 220, paidAmount: null })).toBe(220);
  });

  it("shows an unpaid, fully covered invoice as fully credited and leaves it out of Outstanding", () => {
    expect(isFullyCredited({ totalAmount: 220, paidAmount: null, creditedAmount: 220 })).toBe(true);
    expect(isFullyCredited({ totalAmount: 220, paidAmount: 10, creditedAmount: 220 })).toBe(false);
    expect(isFullyCredited({ totalAmount: 220, paidAmount: null, creditedAmount: 100 })).toBe(false);
    expect(summarizeReceivables([
      { totalAmount: 220, paidAmount: null, creditedAmount: 220 },
      { totalAmount: 100, paidAmount: null, creditedAmount: 40 },
    ])).toEqual({ outstandingCount: 1, outstandingAud: 60 });
  });
});

describe("PDF pieces", () => {
  const createdAt = new Date("2026-10-31T14:30:00Z"); // 1 Nov in Sydney

  it("titles a credit note and names the invoice it credits", () => {
    expect(pdfDocumentTitle({ createdAt })).toBe("TAX INVOICE");
    expect(pdfDocumentTitle({ createdAt, kind: "CREDIT_NOTE" })).toBe("CREDIT NOTE");
    expect(pdfHeaderExtrasHtml({ createdAt, kind: "CREDIT_NOTE", creditsInvoice: { invoiceNumber: "INV-0042" } })).toContain("Credits invoice INV-0042");
  });

  it("prints the client reference and the note to the client, escaped", () => {
    expect(pdfHeaderExtrasHtml({ createdAt, clientReference: "PO <77>" })).toContain("Your reference: PO &lt;77&gt;");
    expect(pdfClientNoteHtml({ createdAt, clientNote: "Thanks\nSee you" })).toContain("Thanks<br />See you");
    expect(pdfClientNoteHtml({ createdAt, clientNote: "  " })).toBe("");
  });

  it("prints negative money with a leading minus", () => {
    expect(pdfMoney(-12.5)).toBe("-$12.50");
    expect(pdfMoney(12.5)).toBe("$12.50");
    expect(pdfMoney(-0)).toBe("$0.00");
  });

  it("prints the same due day the list shows, in the organisation timezone", () => {
    const listDay = invoiceDueDay(createdAt, 14, "Australia/Sydney");
    expect(listDay).toBe("2026-11-15");
    expect(pdfDueLine({ createdAt }, 14, "Australia/Sydney")).toBe("Due: 15 Nov 2026");
    expect(pdfDueLine({ createdAt, kind: "CREDIT_NOTE" }, 14, "Australia/Sydney")).toBeNull();
  });
});

describe("Xero mapping", () => {
  const period = { periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-15T00:00:00Z") };

  it("puts the PO first, then the service period; unchanged without a PO", () => {
    expect(xeroInvoiceReference({ clientReference: null, ...period })).toBe("Service period 2026-10-01 – 2026-10-15");
    expect(xeroInvoiceReference({ clientReference: "PO-9", ...period })).toBe("PO-9 · Service period 2026-10-01 – 2026-10-15");
    expect(xeroInvoiceReference({ clientReference: "PO-9", periodStart: null, periodEnd: null })).toBe("PO-9");
    expect(xeroInvoiceReference({ clientReference: null, periodStart: null, periodEnd: null })).toBeUndefined();
  });

  it("references the credited invoice and sends positive credit-note amounts", () => {
    expect(xeroInvoiceReference({ clientReference: null, ...period, creditsInvoiceNumber: "INV-1" })).toBe("Credit for INV-1");
    expect(xeroCreditNoteLineItem({ description: "Clean", quantity: 1, unitAmount: -165 }).unitAmount).toBe(165);
  });
});

describe("consumers of a negative manual line", () => {
  it("groups a discount under Other charges and subtracts it in the subtotal", () => {
    const groups = groupInvoiceLines([
      { description: "Clean", quantity: 1, unitPrice: 200, lineTotal: 200, category: "SERVICE", job: { property: { name: "Bondi", suburb: null } } },
      { description: "Discount", quantity: 1, unitPrice: -20, lineTotal: -20, category: DISCOUNT_CATEGORY },
    ]);
    const other = groups.find((group) => group.lines.some((line) => line.category === DISCOUNT_CATEGORY));
    expect(other?.subtotal).toBe(-20);
    expect(groups.reduce((sum, group) => sum + group.subtotal, 0)).toBe(180);
  });

  it("keeps operating revenue net of the discount", () => {
    expect(invoiceOperatingRevenue({ totalAmount: 198, lines: [{ category: "SERVICE", lineTotal: 200 }, { category: DISCOUNT_CATEGORY, lineTotal: -20 }] })).toBe(198);
  });
});

describe("screen rules", () => {
  const row = (extra: Record<string, unknown>) => ({
    status: "SENT" as const, xeroInvoiceId: null, xeroExportedAt: null, paidAt: null, paidAmount: null, xeroState: "NONE" as const, overdue: false, ...extra,
  });

  it("never offers payment on a credit note and pushes it only once issued", () => {
    const sent = availableInvoiceActions(row({ kind: "CREDIT_NOTE" }));
    expect(sent).not.toContain("record-payment");
    expect(sent).not.toContain("credit-note");
    expect(sent).toContain("xero-push");
    expect(availableInvoiceActions(row({ kind: "CREDIT_NOTE", status: "DRAFT" }))).not.toContain("xero-push");
    expect(primaryInvoiceAction(row({ kind: "CREDIT_NOTE" }))).toBe("pdf");
  });

  it("does not offer another credit note on a fully credited invoice", () => {
    expect(availableInvoiceActions(row({ kind: "INVOICE", fullyCredited: true }))).not.toContain("credit-note");
  });

  const line = (extra: Partial<EditorLine>): EditorLine => ({
    id: "l1", description: "Clean", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE", note: null,
    shoppingLocked: false, discount: false, discountPercent: null, job: null, propertyId: null, property: null, startedWork: null, ...extra,
  });

  it("locks a discount's amount and applies per-kind rate signs", () => {
    const discount = line({ id: "d", category: DISCOUNT_CATEGORY, discount: true, unitPrice: -10, lineTotal: -10 });
    expect(buildLineUpdates([discount], { d: { description: "Loyalty", quantity: "5", unitPrice: "5" } }).updates).toEqual([{ id: "d", description: "Loyalty" }]);
    expect(buildLineUpdates([line({})], { l1: { description: "Clean", quantity: "1", unitPrice: "-5" } }).invalid.l1).toMatch(/zero or more/);
    expect(buildLineUpdates([line({ unitPrice: -100 })], { l1: { description: "Clean", quantity: "1", unitPrice: "-50" } }, "CREDIT_NOTE").updates).toEqual([
      { id: "l1", description: "Clean", quantity: 1, unitPrice: -50 },
    ]);
    expect(validateNewLine({ description: "Credit", quantity: "1", unitPrice: "10" }, "CREDIT_NOTE")).toMatchObject({ ok: false });
  });
});
