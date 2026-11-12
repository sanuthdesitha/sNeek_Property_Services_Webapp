// @vitest-environment node
import { describe, expect, it } from "vitest";
import { invoicedRevenueByJob, remainingShare, type InvoicedLineRow } from "@/lib/insights/invoiced-revenue";
import { deriveJobFact } from "@/lib/insights/job-facts";
import { moneyFigures } from "@/lib/insights/aggregate";
import { businessCsv } from "@/lib/insights/csv";
import { businessCards } from "@/lib/insights/business";
import { summarise } from "@/lib/insights/aggregate";
import { context, jobRow } from "./insights-fixtures";

const line = (jobId: string, lineTotal: number, credits: number[] = [], subtotal = 200, invoiceId = "inv-1"): InvoicedLineRow => ({
  jobId,
  lineTotal,
  invoice: { id: invoiceId, subtotal, creditNotes: credits.map((value) => ({ subtotal: value })) },
});

describe("Insights revenue from invoiced totals", () => {
  it("uses the invoiced line (ex GST) for an invoiced clean and the scheduled charge otherwise", () => {
    const invoicedByJob = invoicedRevenueByJob([line("job-1", 180)]);
    const invoiced = deriveJobFact(jobRow({ id: "job-1" }), { ...context, invoicedByJob });
    const scheduled = deriveJobFact(jobRow({ id: "job-2" }), { ...context, invoicedByJob });
    expect(invoiced).toMatchObject({ charge: { value: 180, reason: null }, chargeSource: "invoiced" });
    expect(scheduled).toMatchObject({ charge: { value: 150, reason: null }, chargeSource: "scheduled" });
    const money = moneyFigures([invoiced, scheduled], 1);
    expect(money.revenue.value).toBe(330);
    expect(money.revenueSplit).toEqual({ invoiced: 180, invoicedCleans: 1, notYetInvoiced: 150, notYetInvoicedCleans: 1 });
  });

  it("an old period's invoiced revenue does not move when the rate card changes", () => {
    const invoicedByJob = invoicedRevenueByJob([line("job-1", 150)]);
    const raised = { ...context, invoicedByJob, rates: { propertyRates: [{ propertyId: "prop-1", jobType: "AIRBNB_TURNOVER" as const, baseCharge: 999, defaultDescription: null }], priceBook: [] } };
    expect(deriveJobFact(jobRow(), raised).charge.value).toBe(150);
  });

  it("a partial credit note reduces the clean's revenue in proportion; the loader never passes void or fully credited invoices", () => {
    // $200 invoice, $50 credited ex GST: each job line keeps 75%.
    expect(remainingShare({ id: "i", subtotal: 200, creditNotes: [{ subtotal: -50 }] })).toBe(0.75);
    expect(invoicedRevenueByJob([line("job-1", 100, [-50]), line("job-2", 100, [-50])]).get("job-1")).toBe(75);
    // Credits beyond the subtotal never make revenue negative.
    expect(remainingShare({ id: "i", subtotal: 100, creditNotes: [{ subtotal: -150 }] })).toBe(0);
    // A void or fully credited invoice is not live, so its job falls back to the scheduled charge.
    const fact = deriveJobFact(jobRow(), { ...context, invoicedByJob: invoicedRevenueByJob([]) });
    expect(fact.chargeSource).toBe("scheduled");
  });

  it("a skipped clean that was invoiced still counts its invoice; one not invoiced stays excluded", () => {
    const skipped = jobRow({ cleanSkipStatus: "SKIPPED" });
    expect(deriveJobFact(skipped, { ...context, invoicedByJob: new Map([["job-1", 90]]) }).charge.value).toBe(90);
    expect(deriveJobFact(skipped, context).charge.reason).toBe("skipped_clean");
  });

  it("sums several live lines for one job and margin uses the same revenue", () => {
    const invoicedByJob = invoicedRevenueByJob([line("job-1", 100, [], 200, "a"), line("job-1", 50, [], 50, "b")]);
    const fact = deriveJobFact(jobRow(), { ...context, invoicedByJob });
    expect(fact.charge.value).toBe(150);
    const money = moneyFigures([fact], 1);
    // Cost: 3h × $30 = $90 → margin (150 − 90) ÷ 150.
    expect(money.margin.value).toBe(40);
  });

  it("the business CSV lists the invoiced and not-yet-invoiced split", () => {
    const invoicedByJob = new Map([["job-1", 180]]);
    const facts = [deriveJobFact(jobRow({ id: "job-1" }), { ...context, invoicedByJob }), deriveJobFact(jobRow({ id: "job-2" }), { ...context, invoicedByJob })];
    const figures = summarise(facts, { minBasis: 1, money: true, issues: 0 });
    const csv = businessCsv({ cards: businessCards(figures, null), period: { key: "last-month", fromKey: "2026-10-01", toKey: "2026-10-31", days: 31, label: "October 2026", previous: null } });
    expect(csv).toContain('"Revenue invoiced (AUD, ex GST, net of credit notes)",180,1');
    expect(csv).toContain('"Revenue not yet invoiced (AUD, at current rates)",150,1');
  });
});
