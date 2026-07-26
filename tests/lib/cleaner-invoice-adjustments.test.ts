import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * End-to-end-ish coverage of the ADJUSTMENT half of the cleaner invoice:
 *  • which rows the DB query asks for (approved + unsettled, no date window);
 *  • that a job-linked deduction reduces its job line;
 *  • that an approved adjustment whose job is NOT on the invoice still gets
 *    billed, as its own carry-over line (the QA-inspector credit case);
 *  • that a settled adjustment is never billed twice.
 */

const jobFindMany = vi.fn(async () => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);

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
    cleanerPayAdjustment: { findMany: adjFindMany },
    cleanerInvoiceSubmission: { findMany: vi.fn(async () => []) },
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

function job(over: Record<string, unknown> = {}) {
  return {
    id: "job1",
    jobType: "STANDARD_CLEAN",
    estimatedHours: 2,
    scheduledDate: new Date("2026-01-10T00:00:00Z"),
    completedAt: new Date("2026-01-10T04:00:00Z"),
    internalNotes: null,
    isRework: false,
    reworkPayAmount: null,
    property: { name: "Bondi Apt" },
    assignments: [{ userId: "u1", payRate: 50, removedAt: null }],
    ...over,
  };
}

function adj(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    jobId: null,
    title: "Extra payment",
    status: "APPROVED",
    approvedAmount: 40,
    requestedAmount: 40,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    cleanerNote: null,
    requestedAt: new Date("2026-01-11T00:00:00Z"),
    reviewedAt: new Date("2026-01-12T00:00:00Z"),
    ...over,
  };
}

/** First call = the settleable-adjustment query; second = pending adjustments. */
function settleableWhere() {
  return adjFindMany.mock.calls[0][0].where as Record<string, any>;
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

describe("cleaner invoice — approved pay adjustments", { timeout: 30000 }, () => {
  beforeEach(() => {
    jobFindMany.mockClear();
    adjFindMany.mockClear();
    jobFindMany.mockResolvedValue([job()]);
    adjFindMany.mockResolvedValue([]);
  });

  it("selects APPROVED + unsettled rows with NO date window and no job restriction", async () => {
    await build();
    const where = settleableWhere();
    expect(where.status).toBe("APPROVED");
    expect(where.cleanerId).toBe("u1");
    expect(where.includedInPayrollRunId).toBeNull();
    expect(where.includedInCleanerInvoiceId).toBeNull();
    // The old query scoped to `jobId: { in: jobIds }`, which is exactly how
    // approved money went missing.
    expect(where.jobId).toBeUndefined();
    expect(where.requestedAt).toBeUndefined();
    expect(where.reviewedAt).toBeUndefined();
  });

  it("keeps its own rows visible when recomputing an existing invoice", async () => {
    await build({ includeInvoiceId: "inv1" });
    const where = settleableWhere();
    expect(where.includedInCleanerInvoiceId).toBeUndefined();
    expect(where.OR).toEqual([
      { includedInCleanerInvoiceId: null },
      { includedInCleanerInvoiceId: "inv1" },
    ]);
  });

  it("a job-linked DEDUCTION reduces that job's line", async () => {
    adjFindMany
      .mockResolvedValueOnce([adj({ id: "d1", jobId: "job1", approvedAmount: -30, requestedAmount: -30 })])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].approvedExtraAmount).toBe(-30);
    expect(data.rows[0].amount).toBe(70); // 2h × $50 − $30
    expect(data.estimatedPay).toBe(70);
    expect(data.includedAdjustmentIds).toEqual(["d1"]);
  });

  it("an approved credit on a job NOT on this invoice is billed as a carry-over line", async () => {
    // The QA-inspector case: the credit is written against the CLEANER's job,
    // which the payee was never assigned to, so the job never appears here.
    adjFindMany
      .mockResolvedValueOnce([
        adj({ id: "qa1", jobId: "someone-elses-job", approvedAmount: 45, requestedAmount: 45, title: "QA rework credit" }),
      ])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.extraLineRows).toHaveLength(1);
    expect(data.extraLineRows[0].amount).toBe(45);
    expect(data.extraLineTotal).toBe(45);
    expect(data.estimatedPay).toBe(145); // 100 job + 45 credit
    expect(data.includedAdjustmentIds).toEqual(["qa1"]);
  });

  it("a carry-over DEDUCTION is labelled and keeps its negative sign", async () => {
    adjFindMany
      .mockResolvedValueOnce([adj({ id: "cd1", jobId: "old-job", approvedAmount: -20, requestedAmount: -20, title: "Rework" })])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.extraLineRows[0].amount).toBe(-20);
    expect(data.extraLineRows[0].description).toBe("Deduction — Rework");
    expect(data.estimatedPay).toBe(80);
  });

  it("an already-settled adjustment is never billed again (re-run is a no-op)", async () => {
    // The DB query filters it out; assert nothing leaks through if one does.
    adjFindMany
      .mockResolvedValueOnce([adj({ id: "s1", includedInCleanerInvoiceId: "inv-old" })])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.extraLineRows).toHaveLength(0);
    expect(data.includedAdjustmentIds).toHaveLength(0);
    expect(data.estimatedPay).toBe(100);
  });

  it("a payroll-paid adjustment is never billed on an invoice", async () => {
    adjFindMany
      .mockResolvedValueOnce([adj({ id: "p1", includedInPayrollRunId: "run1" })])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.includedAdjustmentIds).toHaveLength(0);
    expect(data.estimatedPay).toBe(100);
  });

  it("reports every settled id so the send route can stamp them", async () => {
    adjFindMany
      .mockResolvedValueOnce([
        adj({ id: "onjob", jobId: "job1", approvedAmount: 10, requestedAmount: 10 }),
        adj({ id: "carry", jobId: null, approvedAmount: 5, requestedAmount: 5 }),
      ])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.includedAdjustmentIds.sort()).toEqual(["carry", "onjob"]);
    expect(data.estimatedPay).toBe(115);
  });
});
