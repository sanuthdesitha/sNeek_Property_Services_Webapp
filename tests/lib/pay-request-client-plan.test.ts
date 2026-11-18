import { describe, expect, it } from "vitest";
import { planPayRequestCharges, type PayRequestClientCharge } from "@/lib/billing/pay-request-client-plan";
import {
  baseClientDescription,
  clientExtraText,
  composeFoldedClientLine,
  recomposeFoldedClientLine,
  toCents,
} from "@/lib/pay-adjustments/invoice-text";
import { calculateShoppingAwareInvoiceTotals } from "@/lib/billing/shopping-client-charges";
import { groupInvoiceLines } from "@/lib/billing/invoice-grouping";
import { buildXeroLineItems } from "@/lib/billing/client-invoice-xero-lines";

/**
 * Pay requests on the CLIENT invoice (owner request 2026-11-18): folded into
 * the job's line on the job's date — one line, combined total, the details in
 * the description — through the ordinary line, so GST, property grouping, the
 * PDF and the Xero lines keep working with no new arithmetic.
 */

function charge(over: Partial<PayRequestClientCharge> = {}): PayRequestClientCharge {
  return {
    adjustmentId: "a1",
    jobId: "job1",
    propertyId: "prop1",
    amount: 45.5,
    title: "Oven deep clean",
    clientDescription: null,
    type: "HOURLY",
    requestedHours: 1.5,
    job: { propertyName: "Bondi Apt", date: "10/11/2026", jobNumber: "J-1" },
    ...over,
  };
}

const jobLine = { jobId: "job1", shoppingRunId: null, description: "Bondi Apt - AIRBNB TURNOVER - 10 Nov 2026", note: null, quantity: 1, unitPrice: 150, lineTotal: 150, category: "SERVICE" };

describe("client invoice folding", () => {
  it("folds two extras into the job's line: one line, total to the cent, base then details", () => {
    const plan = planPayRequestCharges({
      jobLines: [jobLine],
      charges: [charge(), charge({ adjustmentId: "a2", title: "Linen", type: "FIXED", requestedHours: null, amount: 19.99 })],
      invoicedJobIds: new Set(),
    });
    expect(plan.ownLines).toEqual([]);
    expect(plan.folds.map((fold) => fold.adjustmentId)).toEqual(["a1", "a2"]);
    const [line] = plan.jobLines;
    expect(toCents(line.lineTotal)).toBe(toCents(150) + toCents(45.5) + toCents(19.99));
    expect(line.lineTotal).toBe(215.49);
    expect(line.unitPrice).toBe(215.49);
    expect(line.description).toBe(
      ["Bondi Apt - AIRBNB TURNOVER - 10 Nov 2026", "Base service $150.00", "Extra: Oven deep clean (1.5 h) $45.50", "Extra: Linen $19.99"].join("\n"),
    );
  });

  it("never shows the cleaner's rate, pay or note to the client — only the client amount", () => {
    const text = clientExtraText({ title: "Oven", type: "HOURLY", requestedHours: 2 }, 90);
    expect(text).toBe("Extra: Oven (2 h) $90.00");
    expect(text).not.toMatch(/×|\/h|rate/);
    expect(clientExtraText({ title: "Oven", clientDescription: "Oven detail clean" }, 90)).toBe("Extra: Oven detail clean $90.00");
  });

  it("GST and totals come from the existing totals rule over the folded line", () => {
    const plan = planPayRequestCharges({ jobLines: [jobLine], charges: [charge()], invoicedJobIds: new Set() });
    const totals = calculateShoppingAwareInvoiceTotals(plan.jobLines, true);
    expect(totals.subtotal).toBe(195.5);
    expect(totals.gstAmount).toBe(19.55);
    expect(totals.totalAmount).toBe(215.05);
  });

  it("an extra whose job is already on an issued invoice is its own line under that property, naming the job's date", () => {
    const plan = planPayRequestCharges({ jobLines: [], charges: [charge()], invoicedJobIds: new Set(["job1"]) });
    expect(plan.folds).toEqual([]);
    expect(plan.ownLines).toEqual([
      {
        adjustmentId: "a1",
        jobId: null,
        shoppingRunId: null,
        propertyId: "prop1",
        description: "Extra: Oven deep clean (1.5 h) $45.50 — for Bondi Apt, 10/11/2026 (job J-1)",
        note: null,
        quantity: 1,
        unitPrice: 45.5,
        lineTotal: 45.5,
        category: "SERVICE",
      },
    ]);
    // The own line has no jobId, so it can never make the job look billed twice.
    const groups = groupInvoiceLines([{ ...plan.ownLines[0], job: null, property: { name: "Bondi Apt", suburb: null } }]);
    expect(groups[0].title).toMatch(/Bondi Apt/);
    expect(groups[0].isExtras).toBe(false);
  });

  it("waits for the job's own invoice when the job is not billed yet; unlinked extras get their own line", () => {
    const plan = planPayRequestCharges({
      jobLines: [],
      charges: [charge(), charge({ adjustmentId: "u1", jobId: null, job: null })],
      invoicedJobIds: new Set(),
    });
    expect(plan.waiting).toEqual(["a1"]);
    expect(plan.ownLines.map((line) => line.adjustmentId)).toEqual(["u1"]);
    expect(plan.ownLines[0].description).toBe("Extra: Oven deep clean (1.5 h) $45.50");
  });

  it("a job line with a quantity other than one keeps its amount; the extra is its own line", () => {
    const plan = planPayRequestCharges({ jobLines: [{ ...jobLine, quantity: 2, lineTotal: 300 }], charges: [charge()], invoicedJobIds: new Set() });
    expect(plan.jobLines[0].lineTotal).toBe(300);
    expect(plan.ownLines).toHaveLength(1);
  });

  it("adding jobs to a draft folds only; it never adds own lines", () => {
    const plan = planPayRequestCharges({ jobLines: [], charges: [charge({ jobId: null, job: null })], invoicedJobIds: new Set(), includeOwnLines: false });
    expect(plan.ownLines).toEqual([]);
    expect(plan.waiting).toEqual(["a1"]);
  });

  it("un-folding on a draft restores the original line exactly", () => {
    const parts = [{ amount: 45.5, text: "Extra: A $45.50" }, { amount: 19.99, text: "Extra: B $19.99" }];
    const folded = composeFoldedClientLine({ baseDescription: jobLine.description, baseAmount: 150, quantity: 1, extras: parts })!;
    const less = recomposeFoldedClientLine({ line: { ...folded, quantity: 1 }, currentExtras: parts, nextExtras: [parts[1]] })!;
    expect(less.lineTotal).toBe(169.99);
    expect(less.description).toBe([jobLine.description, "Base service $150.00", "Extra: B $19.99"].join("\n"));
    const none = recomposeFoldedClientLine({ line: { ...less, quantity: 1 }, currentExtras: [parts[1]], nextExtras: [] })!;
    expect(none).toEqual({ description: jobLine.description, unitPrice: 150, lineTotal: 150 });
    expect(baseClientDescription(folded.description)).toBe(jobLine.description);
    // A line edited by hand below what it holds cannot be un-folded silently.
    expect(recomposeFoldedClientLine({ line: { ...folded, quantity: 1, unitPrice: 10, lineTotal: 10 }, currentExtras: parts, nextExtras: [] })).toBeNull();
  });

  it("the Xero lines carry the folded description and the combined amount", () => {
    const plan = planPayRequestCharges({ jobLines: [jobLine], charges: [charge()], invoicedJobIds: new Set() });
    const line = plan.jobLines[0];
    const items = buildXeroLineItems(
      [{ ...line, property: null, job: { jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", property: { name: "Bondi Apt", suburb: null } } }],
      { defaultAccountCode: "200" },
      "OUTPUT",
    );
    expect(items).toHaveLength(1);
    expect(items[0].description).toContain("Base service $150.00\nExtra: Oven deep clean (1.5 h) $45.50");
    expect(items[0].quantity).toBe(1);
    expect(items[0].unitAmount).toBe(195.5);
  });
});
