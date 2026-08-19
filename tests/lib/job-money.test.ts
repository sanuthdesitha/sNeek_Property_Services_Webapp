import { describe, it, expect } from "vitest";
import { JobType } from "@prisma/client";
import {
  computeCleanerPay,
  computeClientCharge,
  roundCents,
} from "@/lib/finance/job-money";

const JT = JobType.AIRBNB_TURNOVER;

describe("computeCleanerPay", () => {
  it("job-type-rate path: allocated time × job-type rate, split across cleaners", () => {
    // 3 allocated hours, 2 cleaners → 1.5h each; rate 40 → $60 base.
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 3 },
      { payRate: 40 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 2 }
    );
    expect(pay.source).toBe("JOBTYPE_RATE");
    expect(pay.hours).toBe(1.5);
    expect(pay.rate).toBe(40);
    expect(pay.base).toBe(60);
    expect(pay.total).toBe(60);
    expect(pay.rateMissing).toBe(false);
    expect(pay.payBasis).toBe("ALLOCATED");
  });

  it("resolves the job-type rate from the per-cleaner per-job-type setting when no assignment rate", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 2 },
      { payRate: null, userHourlyRate: null },
      { cleanerJobHourlyRates: { c1: { [JT]: 55 } } },
      { cleanerId: "c1", activeAssignmentCount: 1 }
    );
    expect(pay.rate).toBe(55);
    expect(pay.base).toBe(110);
    expect(pay.rateMissing).toBe(false);
  });

  it("custom-override path: per-job custom payout REPLACES hours×rate base, adjustments add on top", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 5 },
      { payRate: 40 },
      {},
      {
        cleanerId: "c1",
        activeAssignmentCount: 1,
        customPayout: 120,
        approvedAdjustments: 25,
        transportAllowance: 10,
      }
    );
    expect(pay.source).toBe("CUSTOM");
    expect(pay.base).toBe(120); // flat payout, NOT 5×40=200
    expect(pay.adjustments).toBe(25);
    expect(pay.transportAllowance).toBe(10);
    expect(pay.total).toBe(155);
    expect(pay.rateMissing).toBe(false);
  });

  it("a NEGATIVE approved adjustment (deduction) actually reduces pay", () => {
    // Regression: `Math.max(0, approvedAdjustments)` clamped every deduction to
    // zero, so approving a QA rework/rectification deduction in the Approval
    // Center changed the cleaner's invoice by exactly nothing.
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 2 },
      { payRate: 50 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 1, approvedAdjustments: -30 }
    );
    expect(pay.base).toBe(100);
    expect(pay.adjustments).toBe(-30);
    expect(pay.total).toBe(70);
  });

  it("a deduction larger than the job base nets negative rather than silently zeroing", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 1 },
      { payRate: 40 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 1, approvedAdjustments: -60 }
    );
    expect(pay.total).toBe(-20);
  });

  it("mixed additions and deductions net out to the signed sum", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 2 },
      { payRate: 50 },
      {},
      {
        cleanerId: "c1",
        activeAssignmentCount: 1,
        approvedAdjustments: 25 - 40,
        transportAllowance: 10,
      }
    );
    expect(pay.adjustments).toBe(-15);
    expect(pay.total).toBe(95); // 100 − 15 + 10
  });

  it("a non-finite adjustment cannot poison the total with NaN", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 2 },
      { payRate: 50 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 1, approvedAdjustments: Number.NaN }
    );
    expect(pay.adjustments).toBe(0);
    expect(pay.total).toBe(100);
  });

  it("custom payout of 0 is honored (pay nothing for the job)", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 4 },
      { payRate: 40 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 1, customPayout: 0 }
    );
    expect(pay.source).toBe("CUSTOM");
    expect(pay.base).toBe(0);
    expect(pay.total).toBe(0);
  });

  it("missing-rate path: no rate anywhere → flagged + shared default, never a wrong silent number", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 2 },
      { payRate: null, userHourlyRate: null },
      {},
      { cleanerId: "c1", activeAssignmentCount: 1 }
    );
    expect(pay.rateMissing).toBe(true);
    expect(pay.rate).toBe(40); // DEFAULT_CLEANER_HOURLY_RATE
    expect(pay.base).toBe(80);
  });

  it("falls back to timer hours when no allocated time is set", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: null },
      { payRate: 30 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 2, timerHours: 1.5 }
    );
    expect(pay.payBasis).toBe("TIMER");
    expect(pay.split).toBe(1); // timer hours are not split
    expect(pay.hours).toBe(1.5);
    expect(pay.base).toBe(45);
  });

  it("hours override replaces computed hours (but not the custom-payout flat amount)", () => {
    const pay = computeCleanerPay(
      { jobType: JT, estimatedHours: 3 },
      { payRate: 40 },
      {},
      { cleanerId: "c1", activeAssignmentCount: 1, hoursOverride: 2 }
    );
    expect(pay.hours).toBe(2);
    expect(pay.base).toBe(80);
  });
});

describe("computeClientCharge", () => {
  const propertyRates = [
    { propertyId: "p1", jobType: JT, baseCharge: 150, defaultDescription: "Turnover clean" },
  ];
  const priceBook = [{ jobType: JT, baseRate: 99 }];

  it("fixed-client-amount path: Job.fixedPrice wins over everything", () => {
    const charge = computeClientCharge(
      { jobType: JT, propertyId: "p1", fixedPrice: 222 },
      { propertyRates, priceBook }
    );
    expect(charge.source).toBe("FIXED_JOB");
    expect(charge.amount).toBe(222);
    expect(charge.rateMissing).toBe(false);
  });

  it("property-rate path: uses PropertyClientRate.baseCharge when no fixed price", () => {
    const charge = computeClientCharge(
      { jobType: JT, propertyId: "p1", fixedPrice: null },
      { propertyRates, priceBook }
    );
    expect(charge.source).toBe("PROPERTY_RATE");
    expect(charge.amount).toBe(150);
    expect(charge.description).toBe("Turnover clean");
  });

  it("job-type-price path: falls back to PriceBook when no fixed price and no property rate", () => {
    const charge = computeClientCharge(
      { jobType: JT, propertyId: "other", fixedPrice: null },
      { propertyRates, priceBook }
    );
    expect(charge.source).toBe("JOBTYPE_PRICE");
    expect(charge.amount).toBe(99);
  });

  it("missing-rate path: nothing configured → null amount + MISSING, never a fabricated markup", () => {
    const charge = computeClientCharge(
      { jobType: JT, propertyId: "other", fixedPrice: null },
      { propertyRates: [], priceBook: [] }
    );
    expect(charge.source).toBe("MISSING");
    expect(charge.amount).toBeNull();
    expect(charge.rateMissing).toBe(true);
  });
});

describe("computeClientCharge - a zero rate is unfinished setup, not a price", () => {
  const priceBook = [{ jobType: JT, baseRate: 200 }];

  it("does not bill $0 from a property rate of 0", () => {
    // The fixed-price branch already required > 0 for exactly this reason. The
    // property-rate branch did not, so a rate row left at 0 - which is what a
    // newly added property looks like before anyone sets it - returned
    // amount 0 with rateMissing:false. That sailed past the missing-rate guard
    // in generateClientInvoice and billed the client nothing.
    const result = computeClientCharge(
      { jobType: JT, propertyId: "p1", fixedPrice: null },
      { propertyRates: [{ propertyId: "p1", jobType: JT, baseCharge: 0, defaultDescription: null }], priceBook }
    );
    expect(result.amount).not.toBe(0);
    expect(result.source).toBe("JOBTYPE_PRICE");
  });

  it("reports the rate as MISSING when nothing else can price the job", () => {
    // With no price book to fall through to, a 0 rate must surface as missing so
    // generation refuses loudly rather than issuing a $0 line.
    const result = computeClientCharge(
      { jobType: JT, propertyId: "p1", fixedPrice: null },
      { propertyRates: [{ propertyId: "p1", jobType: JT, baseCharge: 0, defaultDescription: null }], priceBook: [] }
    );
    expect(result.rateMissing).toBe(true);
    expect(result.amount).toBeNull();
  });

  it("still honours a genuine positive rate", () => {
    const result = computeClientCharge(
      { jobType: JT, propertyId: "p1", fixedPrice: null },
      { propertyRates: [{ propertyId: "p1", jobType: JT, baseCharge: 150, defaultDescription: null }], priceBook }
    );
    expect(result.amount).toBe(150);
    expect(result.source).toBe("PROPERTY_RATE");
  });
});

describe("roundCents", () => {
  it("rounds to whole cents", () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(60.123)).toBe(60.12);
    expect(roundCents(0)).toBe(0);
  });
});
