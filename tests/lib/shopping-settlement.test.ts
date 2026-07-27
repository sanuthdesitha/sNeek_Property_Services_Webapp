import { describe, it, expect } from "vitest";
import {
  shoppingExpenseCountsTowardPay,
  shoppingTimeCountsTowardPay,
  isShoppingExpenseAvailableForSettlement,
  isShoppingTimeAvailableForSettlement,
  shoppingExpenseSettlementAmount,
  shoppingTimeSettlementAmount,
  sumShoppingPay,
} from "@/lib/finance/shopping-settlement";

/**
 * SHOPPING — the fourth settlement stream (lib/finance/shopping-settlement.ts).
 *
 * Shopping reimbursements and approved shopping time both fold into
 * `getCleanerInvoiceData().estimatedPay`, which lib/phase4/payruns.ts pays and
 * the cleaner's invoice bills. Until these rules existed the two selectors in
 * lib/inventory/shopping-runs.ts filtered on STATUS + a DATE WINDOW only: they
 * never read `ShoppingSettlement.includedInPayrollRunId` and there was no
 * cleaner-invoice stamp at all. So a reimbursement paid by a payroll run was
 * billed again on the next cleaner invoice, and two overlapping invoices could
 * each bill it.
 *
 * These are real staff wages. Every rule below is pinned.
 */

function expenseRow(over: Record<string, unknown> = {}) {
  return {
    id: "run1",
    cleanerReimbursementStatus: "READY",
    expensePayrollRunId: null,
    expenseCleanerInvoiceId: null,
    expenseSettledAmount: null,
    ...over,
  } as any;
}

function timeRow(over: Record<string, unknown> = {}) {
  return {
    id: "run1",
    shoppingTimeStatus: "APPROVED",
    timePayrollRunId: null,
    timeCleanerInvoiceId: null,
    timeSettledAmount: null,
    ...over,
  } as any;
}

// ═══════════════════════════════════════════════════════════════════════════
describe("shoppingExpenseCountsTowardPay", () => {
  it("admits every status except NOT_APPLICABLE", () => {
    expect(shoppingExpenseCountsTowardPay("READY")).toBe(true);
    // INVOICED / REIMBURSED are admitted deliberately: they say what a rail DID,
    // and "already paid" is the STAMPS' question. Narrowing this to READY is what
    // made the guards contradict each other — a run stamped by payroll still read
    // READY (payroll never touches the status) and was billed a second time.
    expect(shoppingExpenseCountsTowardPay("INVOICED")).toBe(true);
    expect(shoppingExpenseCountsTowardPay("REIMBURSED")).toBe(true);
  });

  it("refuses NOT_APPLICABLE — there is nothing to reimburse", () => {
    expect(shoppingExpenseCountsTowardPay("NOT_APPLICABLE")).toBe(false);
  });
});

describe("shoppingTimeCountsTowardPay", () => {
  it("admits only time an admin approved (or a rail has since settled)", () => {
    expect(shoppingTimeCountsTowardPay("APPROVED")).toBe(true);
    expect(shoppingTimeCountsTowardPay("INVOICED")).toBe(true);
    expect(shoppingTimeCountsTowardPay("PAID")).toBe(true);
  });

  it("refuses unrequested and unapproved time", () => {
    // PENDING is a claim nobody signed off; paying it would pay for unapproved hours.
    expect(shoppingTimeCountsTowardPay("PENDING")).toBe(false);
    expect(shoppingTimeCountsTowardPay("NOT_REQUESTED")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("isShoppingExpenseAvailableForSettlement", () => {
  it("an unstamped, applicable reimbursement is payable", () => {
    expect(isShoppingExpenseAvailableForSettlement(expenseRow())).toBe(true);
  });

  it("refuses a reimbursement a payroll run already paid", () => {
    expect(
      isShoppingExpenseAvailableForSettlement(expenseRow({ expensePayrollRunId: "run-9" }))
    ).toBe(false);
  });

  it("refuses a reimbursement a cleaner invoice already billed", () => {
    expect(
      isShoppingExpenseAvailableForSettlement(expenseRow({ expenseCleanerInvoiceId: "inv-9" }))
    ).toBe(false);
  });

  it("un-excludes the payroll run recomputing ITSELF", () => {
    const row = expenseRow({ expensePayrollRunId: "run-1" });
    expect(isShoppingExpenseAvailableForSettlement(row, { includePayrollRunId: "run-1" })).toBe(
      true
    );
    // …but only its own — another run's stamp is still an absolute bar.
    expect(isShoppingExpenseAvailableForSettlement(row, { includePayrollRunId: "run-2" })).toBe(
      false
    );
  });

  it("un-excludes the cleaner invoice recomputing ITSELF", () => {
    const row = expenseRow({ expenseCleanerInvoiceId: "inv-1" });
    expect(isShoppingExpenseAvailableForSettlement(row, { includeInvoiceId: "inv-1" })).toBe(true);
    expect(isShoppingExpenseAvailableForSettlement(row, { includeInvoiceId: "inv-2" })).toBe(false);
  });

  it("recomputing a payroll run does NOT un-exclude the other rail's stamp", () => {
    // The escape hatch is per-rail: a run refreshing itself must not reclaim
    // money a cleaner invoice has already billed.
    expect(
      isShoppingExpenseAvailableForSettlement(expenseRow({ expenseCleanerInvoiceId: "inv-9" }), {
        includePayrollRunId: "run-1",
      })
    ).toBe(false);
  });

  it("a NOT_APPLICABLE run is unavailable however clean its stamps", () => {
    expect(
      isShoppingExpenseAvailableForSettlement(
        expenseRow({ cleanerReimbursementStatus: "NOT_APPLICABLE" })
      )
    ).toBe(false);
  });

  it("reads ONLY the expense stamps — a settled TIME stamp must not hide it", () => {
    // Expense and time settle independently (payroll pays reimbursements but has
    // never paid shopping time), so one being spent says nothing about the other.
    expect(
      isShoppingExpenseAvailableForSettlement(
        expenseRow({ timePayrollRunId: "run-9", timeCleanerInvoiceId: "inv-9" })
      )
    ).toBe(true);
  });

  it("treats a run with no settlement row at all as payable", () => {
    expect(
      isShoppingExpenseAvailableForSettlement({ cleanerReimbursementStatus: "READY" } as any)
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("isShoppingTimeAvailableForSettlement", () => {
  it("unstamped approved time is payable", () => {
    expect(isShoppingTimeAvailableForSettlement(timeRow())).toBe(true);
  });

  it("refuses time either rail already settled", () => {
    expect(isShoppingTimeAvailableForSettlement(timeRow({ timePayrollRunId: "run-9" }))).toBe(
      false
    );
    expect(isShoppingTimeAvailableForSettlement(timeRow({ timeCleanerInvoiceId: "inv-9" }))).toBe(
      false
    );
  });

  it("un-excludes the run/invoice recomputing itself", () => {
    expect(
      isShoppingTimeAvailableForSettlement(timeRow({ timePayrollRunId: "run-1" }), {
        includePayrollRunId: "run-1",
      })
    ).toBe(true);
    expect(
      isShoppingTimeAvailableForSettlement(timeRow({ timeCleanerInvoiceId: "inv-1" }), {
        includeInvoiceId: "inv-1",
      })
    ).toBe(true);
  });

  it("reads ONLY the time stamps — an expense paid by payroll leaves time owed", () => {
    // THE regression this pair of stamps exists for: the primary payroll engine
    // pays reimbursements and has never paid shopping time. Sharing one stamp
    // would silently write off every hour of shopping time it touched.
    expect(
      isShoppingTimeAvailableForSettlement(
        timeRow({ expensePayrollRunId: "run-9", expenseCleanerInvoiceId: "inv-9" })
      )
    ).toBe(true);
  });

  it("refuses PENDING time even when unstamped", () => {
    expect(isShoppingTimeAvailableForSettlement(timeRow({ shoppingTimeStatus: "PENDING" }))).toBe(
      false
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("settlement amounts", () => {
  it("computes live while unsettled", () => {
    expect(shoppingExpenseSettlementAmount({ expenseSettledAmount: null }, 123.456)).toBe(123.46);
    expect(shoppingTimeSettlementAmount({ timeSettledAmount: null }, 60)).toBe(60);
  });

  it("the FROZEN figure wins once settled", () => {
    // Editing a run's line costs after it was billed must not retro-alter what
    // accounts was invoiced.
    expect(shoppingExpenseSettlementAmount({ expenseSettledAmount: 80 }, 500)).toBe(80);
    expect(shoppingTimeSettlementAmount({ timeSettledAmount: 45.5 }, 999)).toBe(45.5);
  });

  it("freezes zero as a real figure, not as 'unset'", () => {
    expect(shoppingExpenseSettlementAmount({ expenseSettledAmount: 0 }, 500)).toBe(0);
    expect(shoppingTimeSettlementAmount({ timeSettledAmount: 0 }, 500)).toBe(0);
  });

  it("ignores a non-finite frozen value and falls back to the computation", () => {
    expect(shoppingExpenseSettlementAmount({ expenseSettledAmount: NaN }, 25)).toBe(25);
  });

  it("sums to whole cents", () => {
    expect(sumShoppingPay([{ amount: 10.005 }, { amount: 0.1 }, { amount: 0.2 }])).toBe(10.31);
    expect(sumShoppingPay([])).toBe(0);
  });
});
