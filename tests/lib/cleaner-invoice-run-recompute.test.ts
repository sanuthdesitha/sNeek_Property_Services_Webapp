import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `includePaidRunId` must cover ALL THREE settlement streams.
 *
 * A pay run that recomputes itself (lib/phase4/payruns.ts refreshPayRun) passes
 * its own id so rows it already stamped stay selectable — otherwise the refresh
 * reads them as "already paid by someone else", drops them from the lines, and
 * then releases the stamps: the run silently stops paying money it had claimed.
 *
 * The option originally reached only `Job.payrollRunId`. `CleanerPayAdjustment`
 * and `QaAssignment` were hard-filtered on `includedInPayrollRunId: null`, so
 * exactly that failure occurred for adjustments and inspections.
 */

const jobFindMany = vi.fn(async (_args?: any) => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);
const qaFindMany = vi.fn(async (_args?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        name: "Payee",
        email: "payee@example.com",
        phone: null,
        address: null,
        suburb: null,
        state: null,
        postcode: null,
        abn: null,
        role: "QA_INSPECTOR",
        hourlyRate: 50,
        bankBsb: null,
        bankAccountNumber: null,
        bankAccountName: null,
      })),
    },
    job: { findMany: jobFindMany },
    cleanerPayAdjustment: { findMany: adjFindMany },
    cleanerInvoiceSubmission: { findMany: vi.fn(async () => []) },
    qaAssignment: { findMany: qaFindMany },
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
  listCleanerReimbursableShoppingRuns: vi.fn(async () => []),
  listCleanerApprovedShoppingTimeRuns: vi.fn(async () => []),
}));

function inspection(over: Record<string, unknown> = {}) {
  return {
    id: "q1",
    status: "COMPLETED",
    completedAt: new Date("2026-01-15T00:00:00Z"),
    onSiteMinutes: null,
    payMode: "FIXED",
    payAmount: 40,
    payHourlyRate: null,
    payHoursAllocated: null,
    payNote: null,
    paySettledAmount: null,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    job: { id: "j1", jobNumber: "J-1", property: { name: "12 Rose St" } },
    ...over,
  };
}

function adj(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    jobId: null,
    title: "Bonus",
    status: "APPROVED",
    approvedAmount: 25,
    requestedAmount: 25,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    cleanerNote: null,
    requestedAt: new Date("2026-01-11T00:00:00Z"),
    reviewedAt: new Date("2026-01-12T00:00:00Z"),
    ...over,
  };
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

describe("getCleanerInvoiceData — includePaidRunId covers all three streams", { timeout: 30000 }, () => {
  beforeEach(() => {
    jobFindMany.mockReset();
    adjFindMany.mockReset();
    qaFindMany.mockReset();
    jobFindMany.mockResolvedValue([]);
    adjFindMany.mockResolvedValue([]);
    qaFindMany.mockResolvedValue([]);
  });

  // ── query shape ──────────────────────────────────────────────────────
  it("un-excludes the run's own JOBS (unchanged behaviour)", async () => {
    await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    expect(jobFindMany.mock.calls[0][0].where.AND).toEqual([
      { OR: [{ payrollRunId: null }, { payrollRunId: "run-1" }] },
    ]);
  });

  it("un-excludes the run's own ADJUSTMENTS", async () => {
    await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    const where = adjFindMany.mock.calls[0][0].where;
    // The blanket "must be null" filter is gone…
    expect(where.includedInPayrollRunId).toBeUndefined();
    // …replaced by "null OR mine".
    expect(where.AND).toEqual([
      { OR: [{ includedInPayrollRunId: null }, { includedInPayrollRunId: "run-1" }] },
    ]);
    // The other rail's stamp is still an absolute bar.
    expect(where.includedInCleanerInvoiceId).toBeNull();
  });

  it("un-excludes the run's own INSPECTIONS", async () => {
    await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    const where = qaFindMany.mock.calls[0][0].where;
    expect(where.includedInPayrollRunId).toBeUndefined();
    expect(where.AND).toContainEqual({
      OR: [{ includedInPayrollRunId: null }, { includedInPayrollRunId: "run-1" }],
    });
    // The date clause stays first and the invoice-stamp clause is untouched.
    expect(where.AND[0].OR[0].completedAt.lte).toBeInstanceOf(Date);
    expect(where.AND).toContainEqual({ includedInCleanerInvoiceId: null });
  });

  it("without includePaidRunId both streams keep the strict null filter", async () => {
    await build({ excludePaidJobs: true });
    expect(adjFindMany.mock.calls[0][0].where.includedInPayrollRunId).toBeNull();
    expect(adjFindMany.mock.calls[0][0].where.AND).toBeUndefined();
    expect(qaFindMany.mock.calls[0][0].where.includedInPayrollRunId).toBeNull();
  });

  // ── in-memory selectors ──────────────────────────────────────────────
  it("keeps this run's own inspection on the recomputed invoice, at its frozen amount", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ includedInPayrollRunId: "run-1", paySettledAmount: 40 }),
    ]);
    const data = await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    expect(data.qaInspectionRows).toHaveLength(1);
    expect(data.qaInspectionRows[0].amount).toBe(40);
    expect(data.includedQaAssignmentIds).toEqual(["q1"]);
    expect(data.estimatedPay).toBe(40);
  });

  it("keeps this run's own adjustment on the recomputed invoice", async () => {
    adjFindMany
      .mockResolvedValueOnce([adj({ includedInPayrollRunId: "run-1" })])
      .mockResolvedValueOnce([]);
    const data = await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    expect(data.includedAdjustmentIds).toEqual(["a1"]);
    expect(data.extraLineRows).toHaveLength(1);
    expect(data.estimatedPay).toBe(25);
  });

  it("still refuses rows stamped by a DIFFERENT run, even when recomputing", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ includedInPayrollRunId: "run-OTHER", paySettledAmount: 40 }),
    ]);
    adjFindMany
      .mockResolvedValueOnce([adj({ includedInPayrollRunId: "run-OTHER" })])
      .mockResolvedValueOnce([]);
    const data = await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    expect(data.qaInspectionRows).toHaveLength(0);
    expect(data.includedAdjustmentIds).toHaveLength(0);
    expect(data.estimatedPay).toBe(0);
  });

  it("still refuses rows the OTHER rail (a cleaner invoice) already billed", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ includedInCleanerInvoiceId: "inv-9", paySettledAmount: 40 }),
    ]);
    adjFindMany
      .mockResolvedValueOnce([adj({ includedInCleanerInvoiceId: "inv-9" })])
      .mockResolvedValueOnce([]);
    const data = await build({ excludePaidJobs: true, includePaidRunId: "run-1" });
    expect(data.qaInspectionRows).toHaveLength(0);
    expect(data.includedAdjustmentIds).toHaveLength(0);
    expect(data.estimatedPay).toBe(0);
  });
});
