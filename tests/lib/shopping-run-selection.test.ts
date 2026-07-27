import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE cleaner-facing shopping selectors (lib/inventory/shopping-runs.ts).
 *
 * `listCleanerReimbursableShoppingRuns` and `listCleanerApprovedShoppingTimeRuns`
 * are what feed `getCleanerInvoiceData`'s `expenseTotal` + `shoppingTimeTotal`,
 * which land in `estimatedPay` — the figure lib/phase4/payruns.ts pays and the
 * cleaner's invoice bills.
 *
 * They used to filter on STATUS + a DATE WINDOW only. They never consulted
 * `ShoppingSettlement.includedInPayrollRunId` (the stamp lib/payroll/engine.ts
 * writes) and no cleaner-invoice stamp existed, so a reimbursement paid by a
 * payroll run was billed all over again on the next cleaner invoice, and two
 * overlapping invoices could each bill it.
 *
 * These tests drive the real record-building path (raw Prisma rows in, records
 * out) so the stamp plumbing — not just the pure rule — is pinned.
 */

const shoppingRunFindMany = vi.fn(async (_args?: any) => [] as any[]);
const appSettingFindUnique = vi.fn(async () => null as any);

vi.mock("@/lib/db", () => ({
  db: {
    appSetting: { findUnique: appSettingFindUnique },
    shoppingRun: { findMany: shoppingRunFindMany },
  },
}));

const CLEANER = "cleaner-1";
const IN_WINDOW = new Date("2026-01-15T00:00:00Z");
const START = new Date("2026-01-01T00:00:00Z");
const END = new Date("2026-01-31T23:59:59Z");

/** A raw ShoppingRun row as `loadShoppingRunsFromDb` returns it. */
function dbRun(over: { compat?: Record<string, unknown>; settlement?: Record<string, unknown> | null } = {}) {
  return {
    id: "run1",
    title: "Woolworths run",
    status: "APPROVED",
    ownerUserId: CLEANER,
    clientId: null,
    legacySource: {
      ownerScope: "CLEANER",
      planningScope: "all",
      clientChargeStatus: "NOT_REQUIRED",
      cleanerReimbursementStatus: "READY",
      shoppingTimeStatus: "APPROVED",
      shoppingTimeRequestedMinutes: 60,
      shoppingTimeApprovedMinutes: 60,
      shoppingTimeApprovedRate: 30,
      ...(over.compat ?? {}),
    },
    owner: { id: CLEANER, name: "Cleaner One", email: "c1@example.com", role: "CLEANER" },
    lines: [
      {
        id: "l1",
        propertyId: "p1",
        property: { id: "p1", name: "12 Rose St", suburb: "Bondi", client: null },
        itemId: null,
        itemName: "Bin liners",
        category: "General",
        supplier: null,
        unit: "unit",
        plannedQty: 1,
        purchasedQty: 1,
        unitCost: 40,
        lineCost: 40,
        status: "PURCHASED",
        note: null,
        updatedAt: IN_WINDOW,
      },
    ],
    receipts: [],
    settlements:
      over.settlement === null
        ? []
        : [
            {
              id: "s1",
              paymentMethod: "CLEANER_CARD",
              paidByScope: "CLEANER",
              paidByUserId: CLEANER,
              paidByUser: null,
              note: null,
              clientBillable: false,
              adminApprovedForClient: false,
              adminApprovedForCleanerReimbursement: true,
              includeInCleanerInvoice: true,
              includedInClientInvoiceId: null,
              includedInCleanerInvoiceReference: null,
              clientInvoice: null,
              includedInPayrollRunId: null,
              includedInCleanerInvoiceId: null,
              paySettledAmount: null,
              timeIncludedInPayrollRunId: null,
              timeIncludedInCleanerInvoiceId: null,
              timePaySettledAmount: null,
              ...(over.settlement ?? {}),
            },
          ],
    startedAt: null,
    submittedAt: IN_WINDOW,
    approvedAt: null,
    closedAt: null,
    createdAt: IN_WINDOW,
    updatedAt: IN_WINDOW,
  };
}

async function expenses(options: Record<string, unknown> = {}) {
  const { listCleanerReimbursableShoppingRuns } = await import("@/lib/inventory/shopping-runs");
  return listCleanerReimbursableShoppingRuns({
    cleanerId: CLEANER,
    start: START,
    end: END,
    ...options,
  } as any);
}

async function times(options: Record<string, unknown> = {}) {
  const { listCleanerApprovedShoppingTimeRuns } = await import("@/lib/inventory/shopping-runs");
  return listCleanerApprovedShoppingTimeRuns({
    cleanerId: CLEANER,
    start: START,
    end: END,
    ...options,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  appSettingFindUnique.mockResolvedValue(null as any);
  shoppingRunFindMany.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════════════════
describe("listCleanerReimbursableShoppingRuns", () => {
  it("selects an unstamped, cleaner-paid run in the window", async () => {
    shoppingRunFindMany.mockResolvedValue([dbRun()]);
    const rows = await expenses();
    expect(rows.map((row) => row.id)).toEqual(["run1"]);
    expect(rows[0].totals.actualTotalCost).toBe(40);
  });

  it("REFUSES a reimbursement a payroll run already paid", async () => {
    // The bug: this run's status is still READY (payroll never touches it), so
    // the old status-only filter handed it straight back to the next invoice.
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { includedInPayrollRunId: "run-9" } }),
    ]);
    expect(await expenses()).toHaveLength(0);
  });

  it("REFUSES a reimbursement another cleaner invoice already billed", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { includedInCleanerInvoiceId: "inv-9" } }),
    ]);
    expect(await expenses()).toHaveLength(0);
  });

  it("keeps the run on the payroll run that is recomputing itself", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { includedInPayrollRunId: "run-1" } }),
    ]);
    expect(await expenses({ includePayrollRunId: "run-1" })).toHaveLength(1);
    expect(await expenses({ includePayrollRunId: "run-2" })).toHaveLength(0);
  });

  it("keeps the run on the invoice that is re-rendering itself", async () => {
    // Its status is INVOICED by then, which the old `status === "READY"` test
    // rejected — the run vanished off its own invoice.
    shoppingRunFindMany.mockResolvedValue([
      dbRun({
        compat: { cleanerReimbursementStatus: "INVOICED" },
        settlement: { includedInCleanerInvoiceId: "inv-1" },
      }),
    ]);
    expect(await expenses({ includeInvoiceId: "inv-1" })).toHaveLength(1);
    expect(await expenses({ includeInvoiceId: "inv-2" })).toHaveLength(0);
  });

  it("still refuses runs that cost nothing, belong to someone else, or fall outside the window", async () => {
    shoppingRunFindMany.mockResolvedValue([
      { ...dbRun(), lines: [] },
      dbRun({ settlement: { paidByUserId: "someone-else" } }),
      { ...dbRun(), submittedAt: new Date("2026-03-01T00:00:00Z"), updatedAt: new Date("2026-03-01T00:00:00Z") },
    ]);
    expect(await expenses()).toHaveLength(0);
  });

  it("refuses a company-paid run — the cleaner is out of pocket for nothing", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { paidByScope: "COMPANY", paymentMethod: "COMPANY_CARD" } }),
    ]);
    expect(await expenses()).toHaveLength(0);
  });

  it("a run with a settled TIME stamp still has its expense selected", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { timeIncludedInPayrollRunId: "run-9" } }),
    ]);
    expect(await expenses()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("listCleanerApprovedShoppingTimeRuns", () => {
  it("selects unstamped approved time in the window", async () => {
    shoppingRunFindMany.mockResolvedValue([dbRun()]);
    const rows = await times();
    expect(rows.map((row) => row.id)).toEqual(["run1"]);
    expect(rows[0].shoppingTime.approvedAmount).toBe(30);
  });

  it("REFUSES time either rail already settled", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { timeIncludedInPayrollRunId: "run-9" } }),
    ]);
    expect(await times()).toHaveLength(0);

    shoppingRunFindMany.mockResolvedValue([
      dbRun({ settlement: { timeIncludedInCleanerInvoiceId: "inv-9" } }),
    ]);
    expect(await times()).toHaveLength(0);
  });

  it("keeps time on the run/invoice recomputing itself", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({
        compat: { shoppingTimeStatus: "INVOICED" },
        settlement: { timeIncludedInCleanerInvoiceId: "inv-1" },
      }),
    ]);
    expect(await times({ includeInvoiceId: "inv-1" })).toHaveLength(1);
    expect(await times({ includeInvoiceId: "inv-2" })).toHaveLength(0);
  });

  it("an EXPENSE paid by payroll leaves the shopping TIME still owed", async () => {
    // The regression the separate stamp pairs exist for: the primary payroll
    // engine pays reimbursements and has never paid shopping time. A shared
    // stamp would silently write off every hour it touched.
    shoppingRunFindMany.mockResolvedValue([
      dbRun({
        settlement: { includedInPayrollRunId: "run-9", includedInCleanerInvoiceId: "inv-9" },
      }),
    ]);
    expect(await times()).toHaveLength(1);
  });

  it("refuses unapproved time, zero minutes and a missing rate", async () => {
    shoppingRunFindMany.mockResolvedValue([
      dbRun({ compat: { shoppingTimeStatus: "PENDING" } }),
      dbRun({ compat: { shoppingTimeApprovedMinutes: 0 } }),
      dbRun({ compat: { shoppingTimeApprovedRate: null } }),
    ]);
    expect(await times()).toHaveLength(0);
  });

  it("selects a run that has no settlement row at all — nothing has paid it", async () => {
    // The normal shape for a time-only run: the cleaner claimed hours but paid
    // for nothing, so no settlement was ever written.
    shoppingRunFindMany.mockResolvedValue([dbRun({ settlement: null })]);
    expect(await times()).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("stampShoppingSettlementsForCleanerInvoice", () => {
  function writer() {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    return { updateMany, client: { shoppingSettlement: { updateMany } } as any };
  }

  it("stamps each stream on its own columns, guarded on BOTH stamps of that stream", async () => {
    const { stampShoppingSettlementsForCleanerInvoice } = await import(
      "@/lib/inventory/shopping-runs"
    );
    const { updateMany, client } = writer();
    await stampShoppingSettlementsForCleanerInvoice(
      {
        ownedRunIds: ["run1"],
        invoiceId: "inv-1",
        expense: [{ runId: "run1", amount: 40 }],
        time: [{ runId: "run1", amount: 30 }],
      },
      client
    );

    const [expense, time] = updateMany.mock.calls.map((call: any[]) => call[0]);
    expect(expense.where).toEqual({
      shoppingRunId: "run1",
      // A payroll run that already claimed it wins; the loser updates 0 rows.
      includedInPayrollRunId: null,
      includedInCleanerInvoiceId: null,
    });
    expect(expense.data.includedInCleanerInvoiceId).toBe("inv-1");
    expect(expense.data.includedInCleanerInvoiceAt).toBeInstanceOf(Date);
    // Frozen at what the PDF actually billed.
    expect(expense.data.paySettledAmount).toBe(40);

    expect(time.where).toEqual({
      shoppingRunId: "run1",
      timeIncludedInPayrollRunId: null,
      timeIncludedInCleanerInvoiceId: null,
    });
    expect(time.data.timeIncludedInCleanerInvoiceId).toBe("inv-1");
    expect(time.data.timePaySettledAmount).toBe(30);
    // Neither write may touch the other stream's columns.
    expect(time.data.includedInCleanerInvoiceId).toBeUndefined();
    expect(expense.data.timeIncludedInCleanerInvoiceId).toBeUndefined();
  });

  it("refuses to stamp a run the cleaner does not own", async () => {
    // ownedRunIds is markCleanerShoppingRunsInvoiced's return value — the single
    // place the ownership check lives. Stamping outside it would mark someone
    // else's money as paid to this cleaner.
    const { stampShoppingSettlementsForCleanerInvoice } = await import(
      "@/lib/inventory/shopping-runs"
    );
    const { updateMany, client } = writer();
    await stampShoppingSettlementsForCleanerInvoice(
      {
        ownedRunIds: ["run1"],
        invoiceId: "inv-1",
        expense: [{ runId: "someone-elses-run", amount: 40 }],
        time: [{ runId: "someone-elses-run", amount: 30 }],
      },
      client
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
