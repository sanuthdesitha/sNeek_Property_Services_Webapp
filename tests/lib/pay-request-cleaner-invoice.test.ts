import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pay requests on the CLEANER invoice (owner request 2026-11-18): an approved
 * job-linked SERVICE extra is folded into the job's line — one line, combined
 * total, the base pay and each extra listed — while parking and reimbursements
 * keep their own non-income section but name the job they relate to, and an
 * unlinked request stays its own line. The amounts come from stored figures and
 * the parts add up to the line to the cent.
 */

const jobFindMany = vi.fn(async () => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: { userPayRate: { findMany: async () => [] }, staffLeave: { findMany: async () => [] }, 
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


async function build(options: Record<string, unknown> = {}) {
  const { getCleanerInvoiceData } = await import("@/lib/cleaner/invoice");
  return getCleanerInvoiceData({ userId: "u1", startDate: "2026-01-01", endDate: "2026-01-31", ...options } as any);
}

const cents = (n: number) => Math.round(n * 100);

describe("cleaner invoice — pay requests folded into the job line", () => {
  beforeEach(() => {
    jobFindMany.mockReset();
    adjFindMany.mockReset();
    jobFindMany.mockResolvedValue([job()]);
  });

  it("folds two SERVICE extras into ONE job line whose total is the sum of its parts to the cent", async () => {
    adjFindMany
      .mockResolvedValueOnce([
        adj({ id: "x1", jobId: "job1", title: "Oven deep clean", type: "HOURLY", requestedHours: 1.5, requestedRate: 33.33, approvedAmount: 50, requestedAmount: 50, cleanerNote: "  Baked-on   grease  " }),
        adj({ id: "x2", jobId: "job1", title: "Extra linen", type: "FIXED", approvedAmount: 12.35, requestedAmount: 12.35 }),
      ])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.rows).toHaveLength(1);
    const row = data.rows[0];
    // 2 h × $50 base, plus $50.00 and $12.35.
    expect(row.baseAmount).toBe(100);
    expect(row.approvedExtraAmount).toBe(62.35);
    expect(cents(row.amount)).toBe(cents(row.baseAmount) + cents(50) + cents(12.35) + cents(row.transportAllowance));
    expect(row.extraDetails).toEqual([
      { id: "x1", label: "Oven deep clean", hours: 1.5, rate: 33.33, amount: 50, note: "Baked-on grease" },
      { id: "x2", label: "Extra linen", hours: null, rate: null, amount: 12.35, note: null },
    ]);
    expect(data.extraLineRows).toEqual([]);
    expect(data.includedAdjustmentIds.sort()).toEqual(["x1", "x2"]);
  });

  it("prints the base pay and each extra under the job on the PDF, and hides hours when asked", async () => {
    adjFindMany
      .mockResolvedValueOnce([adj({ id: "x1", jobId: "job1", title: "Oven", type: "HOURLY", requestedHours: 2, requestedRate: 40, approvedAmount: 80, requestedAmount: 80 })])
      .mockResolvedValueOnce([]);
    const { buildCleanerInvoiceHtml } = await import("@/lib/cleaner/invoice");
    const data = await build();
    const html = buildCleanerInvoiceHtml(data);
    expect(html).toContain("Base pay $100.00");
    expect(html).toContain("Extra: Oven — 2 h × $40.00 — $80.00");
    const hidden = buildCleanerInvoiceHtml({ ...data, showHours: false });
    expect(hidden).toContain("Extra: Oven — $40.00/h — $80.00");
    expect(hidden).not.toContain("2 h ×");
  });

  it("keeps PARKING / REIMBURSEMENT out of the job line, in the non-income section, naming the job", async () => {
    adjFindMany
      .mockResolvedValueOnce([
        adj({ id: "p1", jobId: "job1", title: "Parking", category: "PARKING", taxable: false, approvedAmount: 12, requestedAmount: 12, job: { scheduledDate: new Date("2026-01-10T00:00:00Z"), jobNumber: "J-7", property: { name: "Bondi Apt" } } }),
      ])
      .mockResolvedValueOnce([]);
    const data = await build();
    expect(data.rows[0].approvedExtraAmount).toBe(0);
    expect(data.rows[0].extraDetails).toEqual([]);
    expect(data.extraLineRows).toHaveLength(1);
    expect(data.extraLineRows[0]).toMatchObject({ id: "p1", taxable: false, amount: 12 });
    expect(data.extraLineRows[0].relatedJob).toBe("for Bondi Apt, 10/01/2026 (job J-7)");
    expect(data.nonTaxableTotal).toBe(12);
    expect(data.includedAdjustmentIds).toEqual(["p1"]);
  });

  it("leaves an unlinked request as its own line, as before", async () => {
    adjFindMany.mockResolvedValueOnce([adj({ id: "u9", jobId: null, title: "Training day", approvedAmount: 60 })]).mockResolvedValueOnce([]);
    const data = await build();
    expect(data.rows[0].extraDetails).toEqual([]);
    expect(data.extraLineRows.map((row) => row.id)).toEqual(["u9"]);
    expect(data.extraLineRows[0].relatedJob).toBeNull();
  });

  it("never selects a request marked paid outside the system", async () => {
    adjFindMany
      .mockResolvedValueOnce([adj({ id: "paid", jobId: "job1", paidOutsideAt: new Date("2026-01-13T00:00:00Z") })])
      .mockResolvedValueOnce([]);
    const data = await build();
    // Belt and braces: even if the query drifted, the pure selector drops it.
    expect(data.includedAdjustmentIds).toEqual([]);
    expect(data.rows[0].approvedExtraAmount).toBe(0);
    expect(adjFindMany.mock.calls[0][0].where.AND).toContainEqual({ paidOutsideAt: null });
  });
});
