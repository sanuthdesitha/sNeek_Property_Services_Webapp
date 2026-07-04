import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { emptyDoc } from "@/lib/templates/model";
import { defaultCleanerInvoiceDoc, TEMPLATE_KINDS } from "@/lib/templates/kinds";
import { renderDocumentHtml } from "@/lib/templates/render/document";
import { lintTemplateDoc } from "@/lib/templates/lint";
import { toCleanerInvoiceContractData } from "@/lib/templates/adapters/cleaner-invoice";

const brand = DEFAULT_BRAND_TOKENS;

function fakeCleanerInvoiceData(overrides: Record<string, unknown> = {}) {
  return {
    cleanerName: "Ana Rodriguez",
    cleanerEmail: "ana@example.com",
    cleanerAbn: "12 345 678 901",
    cleanerBankName: "CBA",
    cleanerBankBsb: "062-000",
    cleanerBankAccountNumber: "1234 5678",
    cleanerBankAccountName: "Ana Rodriguez",
    start: new Date("2026-06-01T00:00:00.000Z"),
    end: new Date("2026-06-30T00:00:00.000Z"),
    hours: 9.5,
    estimatedPay: 560,
    showSpentHours: false,
    rows: [
      { jobId: "j1", date: "10 Jun", jobName: "Turnover", property: "12 Marine Parade", jobType: "AIRBNB", split: 1, payBasis: "ALLOCATED", rate: 40, rateMissing: false, hours: 3, originalHours: 3, isHoursOverridden: false, spentHours: null, baseAmount: 240, approvedExtraAmount: 0, transportAllowance: 0, amount: 240 },
      { jobId: "j2", date: "18 Jun", jobName: "Deep clean", property: "88 Ocean View Rd", jobType: "DEEP", split: 1, payBasis: "TIMER", rate: 40, rateMissing: false, hours: 6.5, originalHours: 6.5, isHoursOverridden: false, spentHours: null, baseAmount: 320, approvedExtraAmount: 0, transportAllowance: 0, amount: 320 },
    ],
    expenseRows: [{ runId: "r1", date: "12 Jun", runName: "Shopping run", properties: "Coogee", amount: 48, paymentMethod: "CARD" }],
    expenseTotal: 48,
    shoppingTimeRows: [{ runId: "r1", date: "12 Jun", runName: "Shopping time", properties: "Coogee", minutes: 30, hourlyRate: 44, amount: 22 }],
    shoppingTimeTotal: 22,
    extraLineRows: [{ id: "x1", date: "20 Jun", description: "One-off bonus", amount: 60 }],
    extraLineTotal: 60,
    pendingAdjustmentCount: 1,
    pendingAdjustmentAmount: 40,
    companyName: "sNeek",
    ...overrides,
  } as never;
}

describe("cleaner-invoice adapter", () => {
  it("maps rows/expenses/extras with raw numbers + a summed grand total", () => {
    const data = toCleanerInvoiceContractData(fakeCleanerInvoiceData());
    expect(data.cleaner.name).toBe("Ana Rodriguez");
    expect(data.invoice.number).toBe("INV-20260601-20260630");
    expect(data.summary.jobs).toBe(2);
    expect(data.lines[0].amount).toBe(240); // raw number
    expect(data.totals.grandTotal).toBe(560 + 48 + 22 + 60);
    expect(data.hasExpenses).toBe(true);
    expect(data.hasShoppingTime).toBe(true);
    expect(data.hasExtras).toBe(true);
    expect(data.pending.hasPending).toBe(true);
  });

  it("renders + lints the doc.cleanerInvoice pilot", () => {
    const doc = { ...emptyDoc("doc.cleanerInvoice"), blocks: defaultCleanerInvoiceDoc() };
    expect(lintTemplateDoc(doc, brand).ok).toBe(true);
    const data = toCleanerInvoiceContractData(fakeCleanerInvoiceData());
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).toContain("RECIPIENT-CREATED TAX INVOICE");
    expect(html).toContain("INV-20260601-20260630");
    expect(html).toContain("Turnover · AIRBNB");
    expect(html).toContain("$690"); // grand total
    expect(html).toContain("Shopping reimbursements");
    expect(html).toContain("Pending adjustments");
  });

  it("hides gated sections when empty", () => {
    const doc = { ...emptyDoc("doc.cleanerInvoice"), blocks: defaultCleanerInvoiceDoc() };
    const data = toCleanerInvoiceContractData(
      fakeCleanerInvoiceData({ expenseRows: [], expenseTotal: 0, shoppingTimeRows: [], shoppingTimeTotal: 0, extraLineRows: [], extraLineTotal: 0, pendingAdjustmentCount: 0 }),
    );
    const html = renderDocumentHtml(doc, data, brand, "pdf", {});
    expect(html).not.toContain("Shopping reimbursements");
    expect(html).not.toContain("Pending adjustments");
    expect(html).toContain("Turnover · AIRBNB"); // jobs still render
  });

  it("renders the sample fixture", () => {
    const doc = { ...emptyDoc("doc.cleanerInvoice"), blocks: defaultCleanerInvoiceDoc() };
    const html = renderDocumentHtml(doc, TEMPLATE_KINDS["doc.cleanerInvoice"].sampleData(), brand, "pdf", {});
    expect(html).toContain("Ana Rodriguez");
    expect(html).toContain("$690");
  });
});
