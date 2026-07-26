import { describe, it, expect } from "vitest";
import {
  adjustmentCountsTowardPay,
  adjustmentSignedAmount,
  isAdjustmentAvailableForInvoice,
  partitionAdjustmentsForInvoice,
  sumAdjustments,
  type PayAdjustmentMoneyRow,
} from "@/lib/finance/pay-adjustments";

function row(over: Partial<PayAdjustmentMoneyRow> = {}): PayAdjustmentMoneyRow {
  return {
    id: "adj1",
    jobId: null,
    status: "APPROVED",
    approvedAmount: 50,
    requestedAmount: 50,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    ...over,
  };
}

describe("adjustmentCountsTowardPay — which states change what a cleaner is paid", () => {
  it("counts APPROVED only", () => {
    expect(adjustmentCountsTowardPay({ status: "APPROVED" })).toBe(true);
    expect(adjustmentCountsTowardPay({ status: "PENDING" })).toBe(false);
    expect(adjustmentCountsTowardPay({ status: "REJECTED" })).toBe(false);
  });
});

describe("adjustmentSignedAmount — sign is preserved, never clamped", () => {
  it("returns the approved amount when set", () => {
    expect(adjustmentSignedAmount(row({ approvedAmount: 42.5, requestedAmount: 99 }))).toBe(42.5);
  });

  it("falls back to the requested amount when the approved amount is null", () => {
    expect(adjustmentSignedAmount(row({ approvedAmount: null, requestedAmount: 33 }))).toBe(33);
  });

  it("keeps a DEDUCTION negative (the bug: Math.max(0, …) deleted deductions)", () => {
    expect(adjustmentSignedAmount(row({ approvedAmount: -25, requestedAmount: -25 }))).toBe(-25);
  });

  it("returns 0 for anything not approved, so callers can sum blindly", () => {
    expect(adjustmentSignedAmount(row({ status: "PENDING" }))).toBe(0);
    expect(adjustmentSignedAmount(row({ status: "REJECTED", approvedAmount: 80 }))).toBe(0);
  });

  it("rounds to whole cents", () => {
    expect(adjustmentSignedAmount(row({ approvedAmount: 10.005 }))).toBe(10.01);
  });

  it("treats a non-finite amount as zero rather than NaN-poisoning a total", () => {
    expect(adjustmentSignedAmount(row({ approvedAmount: Number.NaN, requestedAmount: null }))).toBe(0);
  });
});

describe("isAdjustmentAvailableForInvoice — the double-pay guard", () => {
  it("is available when approved and unsettled", () => {
    expect(isAdjustmentAvailableForInvoice(row())).toBe(true);
  });

  it("is NOT available once a payroll run has paid it", () => {
    expect(isAdjustmentAvailableForInvoice(row({ includedInPayrollRunId: "run1" }))).toBe(false);
  });

  it("is NOT available once a cleaner invoice has billed it", () => {
    expect(isAdjustmentAvailableForInvoice(row({ includedInCleanerInvoiceId: "inv1" }))).toBe(false);
  });

  it("stays available to the very invoice that stamped it (recompute)", () => {
    expect(
      isAdjustmentAvailableForInvoice(row({ includedInCleanerInvoiceId: "inv1" }), {
        includeInvoiceId: "inv1",
      })
    ).toBe(true);
  });

  it("is NOT available to a DIFFERENT invoice than the one that stamped it", () => {
    expect(
      isAdjustmentAvailableForInvoice(row({ includedInCleanerInvoiceId: "inv1" }), {
        includeInvoiceId: "inv2",
      })
    ).toBe(false);
  });

  it("is never available while pending or rejected, settled or not", () => {
    expect(isAdjustmentAvailableForInvoice(row({ status: "PENDING" }))).toBe(false);
    expect(isAdjustmentAvailableForInvoice(row({ status: "REJECTED" }))).toBe(false);
  });
});

describe("partitionAdjustmentsForInvoice — what the NEXT invoice picks up", () => {
  const jobLinked = row({ id: "a-job", jobId: "job1", approvedAmount: 20 });
  const qaCredit = row({ id: "a-qa", jobId: "job9", approvedAmount: 15 }); // job not on this invoice
  const unlinked = row({ id: "a-free", jobId: null, approvedAmount: 10 });
  const deduction = row({ id: "a-ded", jobId: "job1", approvedAmount: -8 });

  it("folds job-linked rows into their job and carries the rest over", () => {
    const out = partitionAdjustmentsForInvoice([jobLinked, qaCredit, unlinked, deduction], {
      jobIdsOnInvoice: ["job1"],
    });
    expect(out.perJobTotals.get("job1")).toBe(12); // 20 + (−8)
    expect(out.carryOverRows.map((r) => r.id)).toEqual(["a-qa", "a-free"]);
    expect(out.includedRows.map((r) => r.id).sort()).toEqual(["a-ded", "a-free", "a-job", "a-qa"]);
  });

  it("carries a QA credit whose job is on nobody's invoice — it used to vanish", () => {
    const out = partitionAdjustmentsForInvoice([qaCredit], { jobIdsOnInvoice: [] });
    expect(out.carryOverRows).toHaveLength(1);
    expect(out.perJobTotals.size).toBe(0);
    expect(sumAdjustments(out.includedRows)).toBe(15);
  });

  it("includes an adjustment exactly ONCE on the next invoice", () => {
    const first = partitionAdjustmentsForInvoice([unlinked], { jobIdsOnInvoice: [] });
    expect(first.includedRows).toHaveLength(1);

    // Simulate the send route stamping it, then re-running generation.
    const stamped = { ...unlinked, includedInCleanerInvoiceId: "inv1" };
    const second = partitionAdjustmentsForInvoice([stamped], { jobIdsOnInvoice: [] });
    expect(second.includedRows).toHaveLength(0);
    expect(second.skippedRows).toHaveLength(1);
  });

  it("re-running generation for the SAME invoice does not drop its own rows", () => {
    const stamped = { ...unlinked, includedInCleanerInvoiceId: "inv1" };
    const out = partitionAdjustmentsForInvoice([stamped], {
      jobIdsOnInvoice: [],
      includeInvoiceId: "inv1",
    });
    expect(out.includedRows).toHaveLength(1);
  });

  it("never bills a row a payroll run already paid", () => {
    const paid = { ...unlinked, includedInPayrollRunId: "run1" };
    const out = partitionAdjustmentsForInvoice([paid], { jobIdsOnInvoice: [] });
    expect(out.includedRows).toHaveLength(0);
  });

  it("never surfaces a rejected or pending (voided) adjustment", () => {
    const out = partitionAdjustmentsForInvoice(
      [row({ id: "r", status: "REJECTED" }), row({ id: "p", status: "PENDING" })],
      { jobIdsOnInvoice: [] }
    );
    expect(out.includedRows).toHaveLength(0);
    expect(out.carryOverRows).toHaveLength(0);
    expect(out.skippedRows.map((r) => r.id)).toEqual(["r", "p"]);
  });

  it("handles additions and deductions with the correct sign in one pass", () => {
    const out = partitionAdjustmentsForInvoice(
      [
        row({ id: "add", jobId: null, approvedAmount: 100 }),
        row({ id: "ded", jobId: null, approvedAmount: -30 }),
      ],
      { jobIdsOnInvoice: [] }
    );
    expect(sumAdjustments(out.carryOverRows)).toBe(70);
  });

  it("applies no date window — a late approval is still owed", () => {
    // The rule module has no date input at all; an adjustment approved long
    // after its job's period must still be selectable.
    const out = partitionAdjustmentsForInvoice([row({ id: "late", jobId: "old-job" })], {
      jobIdsOnInvoice: [],
    });
    expect(out.includedRows.map((r) => r.id)).toEqual(["late"]);
  });
});
