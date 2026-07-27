import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SHOPPING on the cleaner invoice (lib/cleaner/invoice.ts).
 *
 * `expenseTotal` + `shoppingTimeTotal` are folded straight into `estimatedPay`,
 * which lib/phase4/payruns.ts pays and the invoice send route bills. That makes
 * shopping the FOURTH settlement stream, and it was the only one whose selection
 * ignored the settlement stamps entirely — so the invoice had to be taught to
 * pass `includePaidRunId` / `includeInvoiceId` down to it exactly as it already
 * did for jobs, adjustments and QA inspections.
 */

const listExpenseRuns = vi.fn(async (_input?: any) => [] as any[]);
const listTimeRuns = vi.fn(async (_input?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        name: "Cleaner One",
        email: "c1@example.com",
        phone: null,
        address: null,
        suburb: null,
        state: null,
        postcode: null,
        abn: null,
        role: "CLEANER",
        hourlyRate: 40,
        bankBsb: null,
        bankAccountNumber: null,
        bankAccountName: null,
      })),
    },
    job: { findMany: vi.fn(async () => []) },
    cleanerPayAdjustment: { findMany: vi.fn(async () => []) },
    cleanerInvoiceSubmission: { findMany: vi.fn(async () => []) },
    qaAssignment: { findMany: vi.fn(async () => []) },
    timeLog: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({
    companyName: "sNeek",
    cleanerJobHourlyRates: {},
    reportLogoUrl: "",
    logoUrl: "",
    qaPay: {
      defaultMode: "HOURLY",
      defaultFixedAmount: 0,
      defaultHourlyRate: 30,
      defaultHoursPerInspection: 1,
    },
  })),
}));

vi.mock("@/lib/inventory/shopping-runs", () => ({
  listCleanerReimbursableShoppingRuns: (input: any) => listExpenseRuns(input),
  listCleanerApprovedShoppingTimeRuns: (input: any) => listTimeRuns(input),
}));

/** A shopping run record as the selectors return it. */
function run(over: Record<string, unknown> = {}) {
  return {
    id: "run1",
    name: "Woolworths run",
    completedAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    createdAt: "2026-01-15T00:00:00.000Z",
    rows: [{ propertyName: "12 Rose St" }],
    totals: { actualTotalCost: 40 },
    payment: { method: "CLEANER_PERSONAL_CARD", note: null },
    reimbursementNote: null,
    shoppingTime: { approvedMinutes: 60, approvedRate: 30, approvedAmount: 30, note: null },
    settlement: {
      settlementId: "s1",
      expensePayrollRunId: null,
      expenseCleanerInvoiceId: null,
      expenseSettledAmount: null,
      timePayrollRunId: null,
      timeCleanerInvoiceId: null,
      timeSettledAmount: null,
    },
    ...over,
  } as any;
}

async function build(options: Record<string, unknown> = {}) {
  const { getCleanerInvoiceData } = await import("@/lib/cleaner/invoice");
  return getCleanerInvoiceData({
    userId: "u1",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    ...options,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  listExpenseRuns.mockResolvedValue([]);
  listTimeRuns.mockResolvedValue([]);
});

describe("getCleanerInvoiceData — shopping settlement", { timeout: 30000 }, () => {
  // ── the options actually reach the selectors ─────────────────────────
  it("threads the pay-run and invoice ids into BOTH shopping selectors", async () => {
    await build({ excludePaidJobs: true, includePaidRunId: "run-1", includeInvoiceId: "inv-1" });
    for (const fn of [listExpenseRuns, listTimeRuns]) {
      const input = fn.mock.calls[0][0];
      expect(input.cleanerId).toBe("u1");
      expect(input.includePayrollRunId).toBe("run-1");
      expect(input.includeInvoiceId).toBe("inv-1");
      expect(input.start).toBeInstanceOf(Date);
      expect(input.end).toBeInstanceOf(Date);
    }
  });

  it("passes null (not undefined) when neither rail is recomputing", async () => {
    // null is what `isShopping*AvailableForSettlement` compares a stamp against;
    // leaking `undefined` would make an unstamped-vs-stamped comparison ambiguous.
    await build();
    expect(listExpenseRuns.mock.calls[0][0].includePayrollRunId).toBeNull();
    expect(listExpenseRuns.mock.calls[0][0].includeInvoiceId).toBeNull();
  });

  // ── totals ───────────────────────────────────────────────────────────
  it("folds both shopping streams into estimatedPay", async () => {
    listExpenseRuns.mockResolvedValue([run()]);
    listTimeRuns.mockResolvedValue([run()]);
    const data = await build();
    expect(data.expenseTotal).toBe(40);
    expect(data.shoppingTimeTotal).toBe(30);
    expect(data.estimatedPay).toBe(70);
  });

  it("bills the FROZEN amount once a rail has settled the run", async () => {
    // Editing a run's line costs or approved rate after it was billed must not
    // retro-alter what accounts was invoiced.
    listExpenseRuns.mockResolvedValue([
      run({
        totals: { actualTotalCost: 500 },
        settlement: { ...run().settlement, expenseSettledAmount: 40 },
      }),
    ]);
    listTimeRuns.mockResolvedValue([
      run({
        shoppingTime: { approvedMinutes: 60, approvedRate: 999, approvedAmount: 999, note: null },
        settlement: { ...run().settlement, timeSettledAmount: 30 },
      }),
    ]);
    const data = await build();
    expect(data.expenseRows[0].amount).toBe(40);
    expect(data.shoppingTimeRows[0].amount).toBe(30);
    expect(data.estimatedPay).toBe(70);
  });

  it("rounds shopping totals to whole cents", async () => {
    listExpenseRuns.mockResolvedValue([
      run({ id: "a", totals: { actualTotalCost: 10.005 } }),
      run({ id: "b", totals: { actualTotalCost: 0.1 } }),
      run({ id: "c", totals: { actualTotalCost: 0.2 } }),
    ]);
    const data = await build();
    expect(data.expenseTotal).toBe(10.31);
  });

  // ── the cleaner's own removals still win ─────────────────────────────
  it("still honours excludedRunIds for both streams", async () => {
    listExpenseRuns.mockResolvedValue([run()]);
    listTimeRuns.mockResolvedValue([run()]);
    const data = await build({ excludedRunIds: ["run1"] });
    expect(data.expenseRows).toHaveLength(0);
    expect(data.shoppingTimeRows).toHaveLength(0);
    expect(data.estimatedPay).toBe(0);
  });

  // ── the ids the send route / pay run stamp on ────────────────────────
  it("exposes the run id on every shopping row so it can be stamped", async () => {
    listExpenseRuns.mockResolvedValue([run()]);
    listTimeRuns.mockResolvedValue([run()]);
    const data = await build();
    expect(data.expenseRows[0].runId).toBe("run1");
    expect(data.shoppingTimeRows[0].runId).toBe("run1");
  });
});
