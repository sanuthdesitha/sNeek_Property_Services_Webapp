import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Payroll must pay every approved adjustment to the person it names — including
 * a payee who is not role CLEANER (QA inspectors are credited for rework /
 * rectification), and including one approved AFTER its period closed.
 */

const userFindMany = vi.fn(async (_args?: any) => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: userFindMany },
    job: { findMany: vi.fn(async () => []) },
    cleanerPayAdjustment: { findMany: adjFindMany },
    shoppingRun: { findMany: vi.fn(async () => []) },
    // QA inspection pay is the other rail getPayrollSummary now reads. These
    // cases are about ADJUSTMENT payees, so it returns nothing here.
    qaAssignment: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({
    cleanerJobHourlyRates: {},
    qaPay: {
      defaultMode: "HOURLY",
      defaultFixedAmount: 0,
      defaultHourlyRate: 32,
      defaultHoursPerInspection: 1,
    },
  })),
}));

const CLEANER = { id: "c1", name: "Cleaner One", email: "c1@x.com", hourlyRate: 40 };
const QA = { id: "qa1", name: "QA One", email: "qa1@x.com", hourlyRate: null };

function adj(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    cleanerId: "c1",
    title: "Adjustment",
    requestedAmount: 50,
    approvedAmount: 50,
    reviewedAt: new Date("2026-01-15T00:00:00Z"),
    jobId: null,
    property: null,
    ...over,
  };
}

async function run(input: Record<string, unknown> = {}) {
  const { getPayrollSummary } = await import("@/lib/finance/payroll");
  return getPayrollSummary({ startDate: "2026-01-01", endDate: "2026-01-31", ...input } as any);
}

describe("getPayrollSummary — adjustment payees", { timeout: 30000 }, () => {
  beforeEach(() => {
    userFindMany.mockReset();
    adjFindMany.mockReset();
    adjFindMany.mockResolvedValue([]);
  });

  it("pays a QA inspector their approved credit even though they are not role CLEANER", async () => {
    // 1st user query = the CLEANER roster; 2nd = the extra non-cleaner payees.
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    adjFindMany.mockResolvedValue([
      adj({ id: "qa-credit", cleanerId: "qa1", title: "QA rework credit", approvedAmount: 35, requestedAmount: 35 }),
    ]);

    const rows = await run();
    const qaRow = rows.find((r) => r.cleaner.id === "qa1");
    expect(qaRow).toBeDefined();
    expect(qaRow!.adjustments.map((a) => a.amount)).toEqual([35]);
    expect(qaRow!.totals.grossPay).toBe(35);

    // The follow-up lookup asks only for the ids that were missing.
    expect(userFindMany.mock.calls[1][0].where.id.in).toEqual(["qa1"]);
  });

  it("does not run the extra payee lookup when every payee is already a cleaner", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]);
    adjFindMany.mockResolvedValue([adj()]);
    const rows = await run();
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.cleaner.id === "c1")!.totals.adjustments).toBe(50);
  });

  it("keeps a DEDUCTION negative in the payroll total", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]);
    adjFindMany.mockResolvedValue([
      adj({ id: "d", approvedAmount: -25, requestedAmount: -25, title: "QA rework deduction" }),
    ]);
    const rows = await run();
    expect(rows[0].totals.adjustments).toBe(-25);
    expect(rows[0].totals.grossPay).toBe(-25);
  });

  it("a committable run picks up an adjustment approved AFTER the period closed", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]);
    await run({ excludePaidJobs: true });
    const where = adjFindMany.mock.calls[0][0].where;
    // No lower bound — a late approval was previously outside every window and
    // therefore never paid by any run.
    expect(where.reviewedAt.gte).toBeUndefined();
    expect(where.reviewedAt.lte).toBeInstanceOf(Date);
    // Double-pay is prevented by the settlement stamp, not by the date window.
    expect(where.includedInPayrollRunId).toBeNull();
  });

  it("the read-only period view keeps its bounded window (historical reports stay stable)", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]);
    await run();
    const where = adjFindMany.mock.calls[0][0].where;
    expect(where.reviewedAt.gte).toBeInstanceOf(Date);
    expect(where.reviewedAt.lte).toBeInstanceOf(Date);
    expect(where.includedInPayrollRunId).toBeUndefined();
  });
});
