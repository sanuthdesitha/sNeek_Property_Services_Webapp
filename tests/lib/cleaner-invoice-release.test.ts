import { describe, it, expect, vi } from "vitest";
import { releaseCleanerInvoiceConsumables } from "@/lib/cleaner/invoice-release";

/**
 * A CANCELLED PAYEE INVOICE MUST HAND THE WORK BACK.
 *
 * Voiding or deleting a submission released only the jobs. The payee's approved
 * extra pay, their QA inspection fees and their out-of-pocket shopping stayed
 * stamped against an invoice that would never be paid — and the invoice builder
 * excludes on exactly that stamp, so they could never be billed again. Somebody
 * quietly stopped being able to claim money they were owed, with no error and no
 * way to find out why.
 *
 * The transaction client is a stub: what is being pinned is WHICH tables are
 * cleared and by WHAT key, and that is entirely visible in the arguments.
 */
function stubTx(counts = { adj: 2, qa: 1, shopping: 3, travel: 2 }) {
  const cleanerPayAdjustment = { updateMany: vi.fn(async () => ({ count: counts.adj })) };
  const qaAssignment = { updateMany: vi.fn(async () => ({ count: counts.qa })) };
  const shoppingSettlement = { updateMany: vi.fn(async () => ({ count: counts.shopping })) };
  const qaDayAllowance = { updateMany: vi.fn(async () => ({ count: counts.travel })) };
  return {
    tx: { cleanerPayAdjustment, qaAssignment, shoppingSettlement, qaDayAllowance } as any,
    cleanerPayAdjustment,
    qaAssignment,
    shoppingSettlement,
    qaDayAllowance,
  };
}

describe("releaseCleanerInvoiceConsumables", () => {
  it("frees the payee's approved pay adjustments", async () => {
    const { tx, cleanerPayAdjustment } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "sub-1");

    expect(cleanerPayAdjustment.updateMany).toHaveBeenCalledWith({
      where: { includedInCleanerInvoiceId: "sub-1" },
      // Both columns: a released adjustment must not read as invoiced on a date
      // it no longer belongs to.
      data: { includedInCleanerInvoiceId: null, includedInCleanerInvoiceAt: null },
    });
  });

  it("frees their QA inspection fees", async () => {
    const { tx, qaAssignment } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "sub-1");

    expect(qaAssignment.updateMany).toHaveBeenCalledWith({
      where: { includedInCleanerInvoiceId: "sub-1" },
      data: { includedInCleanerInvoiceId: null, includedInCleanerInvoiceAt: null },
    });
  });

  it("frees their out-of-pocket shopping", async () => {
    const { tx, shoppingSettlement } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "sub-1");

    expect(shoppingSettlement.updateMany).toHaveBeenCalledWith({
      where: { includedInCleanerInvoiceId: "sub-1" },
      data: { includedInCleanerInvoiceId: null, includedInCleanerInvoiceAt: null },
    });
  });

  it("frees their claimed travel days", async () => {
    // A voided invoice that kept its claim would leave the day permanently
    // unpayable: the unique constraint means nothing else can claim it either.
    const { tx, qaDayAllowance } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "sub-1");

    expect(qaDayAllowance.updateMany).toHaveBeenCalledWith({
      where: { includedInCleanerInvoiceId: "sub-1" },
      data: { includedInCleanerInvoiceId: null },
    });
  });

  it("scopes to this submission, never releasing another payee's items", async () => {
    const { tx, cleanerPayAdjustment, qaAssignment, shoppingSettlement, qaDayAllowance } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "sub-2");

    for (const model of [cleanerPayAdjustment, qaAssignment, shoppingSettlement, qaDayAllowance]) {
      expect(model.updateMany.mock.calls.some(([call]) => JSON.stringify(call.where) === JSON.stringify({ includedInCleanerInvoiceId: "sub-2" }))).toBe(true);
    }
  });

  it("reports what it freed, so the void can be logged honestly", async () => {
    const { tx } = stubTx({ adj: 2, qa: 1, shopping: 3, travel: 2 });
    await expect(releaseCleanerInvoiceConsumables(tx, "sub-1")).resolves.toEqual({
      adjustments: 2,
      qaInspections: 1,
      shoppingSettlements: 3,
      shoppingTimeSettlements: 3,
      travelDays: 2,
    });
  });

  it("is fine when the invoice carried nothing but jobs", async () => {
    const { tx } = stubTx({ adj: 0, qa: 0, shopping: 0, travel: 0 });
    await expect(releaseCleanerInvoiceConsumables(tx, "sub-1")).resolves.toEqual({
      adjustments: 0,
      qaInspections: 0,
      shoppingSettlements: 0,
      shoppingTimeSettlements: 0,
      travelDays: 0,
    });
  });

  it("touches every settlement table on each call", async () => {
    // Missing one table would be the same bug in a smaller shape: whatever was
    // skipped stays permanently unbillable.
    const { tx, cleanerPayAdjustment, qaAssignment, shoppingSettlement, qaDayAllowance } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "sub-1");
    expect(cleanerPayAdjustment.updateMany).toHaveBeenCalledTimes(1);
    expect(qaAssignment.updateMany).toHaveBeenCalledTimes(2);
    expect(shoppingSettlement.updateMany).toHaveBeenCalledTimes(4);
    expect(qaDayAllowance.updateMany).toHaveBeenCalledTimes(1);
  });
});


describe("independent settlement release", () => {
  it("releases shopping time and clears only this invoice's unpayrolled frozen amounts", async () => {
    const { tx, shoppingSettlement, qaAssignment } = stubTx();
    await releaseCleanerInvoiceConsumables(tx, "invoice-a");
    expect(shoppingSettlement.updateMany).toHaveBeenCalledWith({
      where: { timeIncludedInCleanerInvoiceId: "invoice-a", timeIncludedInPayrollRunId: null },
      data: { timePaySettledAmount: null },
    });
    expect(shoppingSettlement.updateMany).toHaveBeenCalledWith({
      where: { timeIncludedInCleanerInvoiceId: "invoice-a" },
      data: { timeIncludedInCleanerInvoiceId: null, timeIncludedInCleanerInvoiceAt: null },
    });
    for (const model of [shoppingSettlement, qaAssignment]) {
      expect(model.updateMany).toHaveBeenCalledWith({
        where: { includedInCleanerInvoiceId: "invoice-a", includedInPayrollRunId: null },
        data: { paySettledAmount: null },
      });
      for (const [call] of model.updateMany.mock.calls) {
        expect(call.data).not.toHaveProperty("includedInPayrollRunId");
        expect(call.data).not.toHaveProperty("timeIncludedInPayrollRunId");
      }
    }
  });
});
