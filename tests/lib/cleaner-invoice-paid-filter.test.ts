import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the `where` passed to db.job.findMany so we can assert the payroll
// idempotency filter (Job.payrollRunId) is applied exactly when requested.
const jobFindMany = vi.fn(async () => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        name: "Cleaner",
        email: "cleaner@example.com",
        phone: null,
        address: null,
        suburb: null,
        state: null,
        postcode: null,
        abn: null,
        hourlyRate: 30,
        bankBsb: null,
        bankAccountNumber: null,
        bankAccountName: null,
      })),
    },
    job: { findMany: jobFindMany },
    cleanerPayAdjustment: { findMany: vi.fn(async () => []) },
    timeLog: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({
    companyName: "sNeek",
    cleanerJobHourlyRates: {},
    reportLogoUrl: "",
    logoUrl: "",
  })),
}));

vi.mock("@/lib/inventory/shopping-runs", () => ({
  listCleanerReimbursableShoppingRuns: vi.fn(async () => []),
  listCleanerApprovedShoppingTimeRuns: vi.fn(async () => []),
}));

function lastWhere() {
  return jobFindMany.mock.calls[0][0] as { where: any };
}

describe("getCleanerInvoiceData paid-job idempotency filter (C1)", () => {
  beforeEach(() => {
    jobFindMany.mockClear();
  });

  it("does NOT filter by payrollRunId by default (cleaner-facing invoices show all jobs)", async () => {
    const { getCleanerInvoiceData } = await import("@/lib/cleaner/invoice");
    await getCleanerInvoiceData({ userId: "u1", startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(lastWhere().where.AND).toBeUndefined();
  });

  it("excludes already-paid jobs (payrollRunId: null) when excludePaidJobs is set", async () => {
    const { getCleanerInvoiceData } = await import("@/lib/cleaner/invoice");
    await getCleanerInvoiceData({
      userId: "u1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      excludePaidJobs: true,
    });
    expect(lastWhere().where.AND).toEqual([{ payrollRunId: null }]);
  });

  it("still includes the run's own jobs when recomputing (includePaidRunId)", async () => {
    const { getCleanerInvoiceData } = await import("@/lib/cleaner/invoice");
    await getCleanerInvoiceData({
      userId: "u1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      excludePaidJobs: true,
      includePaidRunId: "run-123",
    });
    expect(lastWhere().where.AND).toEqual([
      { OR: [{ payrollRunId: null }, { payrollRunId: "run-123" }] },
    ]);
  });
});
