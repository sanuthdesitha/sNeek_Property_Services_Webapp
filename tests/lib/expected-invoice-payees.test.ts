import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The admin payday forecast must cover EVERY payee who invoices.
 *
 * getExpectedInvoicesForPeriod predicts what each self-invoicing payee is about
 * to bill, so the admin can prepare the money. It used to select
 * `role: CLEANER` only. QA inspectors invoice on the same rail and hold no
 * cleaner assignments, so their upcoming inspection pay was invisible here even
 * though the invoice endpoint would happily bill it — real money the forecast
 * silently omitted. These tests pin the widened payee set and the
 * inspections-only inclusion rule.
 */

const userFindMany = vi.fn(async (_args?: any) => [] as any[]);
const submissionFindFirst = vi.fn(async () => null);
const getCleanerInvoiceData = vi.fn(async (_opts: any) => emptyInvoice());

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: (a: any) => userFindMany(a) },
    cleanerInvoiceSubmission: { findFirst: () => submissionFindFirst() },
  },
}));
vi.mock("@/lib/cleaner/invoice", () => ({
  getCleanerInvoiceData: (o: any) => getCleanerInvoiceData(o),
}));

import { getExpectedInvoicesForPeriod } from "@/lib/cleaner/expected-invoice";

function emptyInvoice(overrides: Record<string, any> = {}) {
  return {
    cleanerName: "Payee",
    start: new Date("2026-07-01T00:00:00.000Z"),
    end: new Date("2026-07-31T00:00:00.000Z"),
    hours: 0,
    estimatedPay: 0,
    rows: [],
    expenseRows: [],
    expenseTotal: 0,
    shoppingTimeRows: [],
    shoppingTimeTotal: 0,
    extraLineRows: [],
    extraLineTotal: 0,
    qaInspectionRows: [],
    qaInspectionTotal: 0,
    includedQaAssignmentIds: [],
    includedAdjustmentIds: [],
    pendingAdjustmentCount: 0,
    pendingAdjustmentAmount: 0,
    ...overrides,
  } as any;
}

beforeEach(() => {
  userFindMany.mockReset();
  userFindMany.mockImplementation(async () => []);
  getCleanerInvoiceData.mockReset();
  getCleanerInvoiceData.mockImplementation(async () => emptyInvoice());
  submissionFindFirst.mockReset();
  submissionFindFirst.mockImplementation(async () => null);
});

describe("expected invoices — payee set", () => {
  it("selects BOTH cleaners and QA inspectors, not cleaners alone", async () => {
    await getExpectedInvoicesForPeriod({ startDate: "2026-07-01", endDate: "2026-07-31" });
    const where = userFindMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: expect.arrayContaining(["CLEANER", "QA_INSPECTOR"]) });
    expect([...where.role.in].sort()).toEqual(["CLEANER", "QA_INSPECTOR"]);
    expect(where.isActive).toBe(true);
  });

  it("reads each payee's role so the admin view can tell them apart", async () => {
    await getExpectedInvoicesForPeriod({});
    expect(userFindMany.mock.calls[0][0].select.role).toBe(true);
  });

  it("includes an inspections-only inspector — no cleans is not 'nothing to pay'", async () => {
    userFindMany.mockImplementation(async () => [
      { id: "qa1", name: "Jane Inspector", email: "jane@x.com", employmentType: null, role: "QA_INSPECTOR" },
    ]);
    getCleanerInvoiceData.mockImplementation(async () =>
      emptyInvoice({
        estimatedPay: 180,
        qaInspectionRows: [
          { assignmentId: "a1", date: "2026-07-04", property: "Unit 1", amount: 90 },
          { assignmentId: "a2", date: "2026-07-05", property: "Unit 2", amount: 90 },
        ],
        qaInspectionTotal: 180,
      })
    );

    const result = await getExpectedInvoicesForPeriod({});
    expect(result.cleaners).toHaveLength(1);
    const payee = result.cleaners[0];
    expect(payee.role).toBe("QA_INSPECTOR");
    expect(payee.jobCount).toBe(0);
    expect(payee.qaInspectionCount).toBe(2);
    expect(payee.qaInspectionTotal).toBe(180);
    expect(payee.expectedTotal).toBe(180);
    // The money to prepare on payday includes the inspector's inspections.
    expect(result.grandExpectedTotal).toBe(180);
  });

  it("still drops a payee with genuinely nothing in the period", async () => {
    userFindMany.mockImplementation(async () => [
      { id: "c1", name: "Bob", email: "bob@x.com", employmentType: "CONTRACTOR", role: "CLEANER" },
    ]);
    const result = await getExpectedInvoicesForPeriod({});
    expect(result.cleaners).toEqual([]);
    expect(result.grandExpectedTotal).toBe(0);
  });

  it("forecasts each payee from their OWN id — never a shared or leaked one", async () => {
    userFindMany.mockImplementation(async () => [
      { id: "c1", name: "Bob", email: "bob@x.com", employmentType: "CONTRACTOR", role: "CLEANER" },
      { id: "qa1", name: "Jane", email: "jane@x.com", employmentType: null, role: "QA_INSPECTOR" },
    ]);
    await getExpectedInvoicesForPeriod({});
    expect(getCleanerInvoiceData.mock.calls.map((c) => c[0].userId)).toEqual(["c1", "qa1"]);
    // Only what's still owed is forecast (nothing already on a pay run).
    for (const call of getCleanerInvoiceData.mock.calls) {
      expect(call[0].excludePaidJobs).toBe(true);
    }
  });
});
