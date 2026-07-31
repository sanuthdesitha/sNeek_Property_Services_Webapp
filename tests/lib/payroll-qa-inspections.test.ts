import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * QA inspections must reach payroll on the SAME rail as cleaner job pay:
 * completed inspections become payable lines for the inspector (who holds no
 * cleaner assignments and would otherwise never appear on a run), settled work
 * is never selected again, and a settled amount is frozen at what was paid.
 */

const userFindMany = vi.fn(async (_args?: any) => [] as any[]);
const qaFindMany = vi.fn(async (_args?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: userFindMany },
    job: { findMany: vi.fn(async () => []) },
    cleanerPayAdjustment: { findMany: vi.fn(async () => []) },
    shoppingRun: { findMany: vi.fn(async () => []) },
    qaAssignment: { findMany: qaFindMany },
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({
    cleanerJobHourlyRates: {},
    qaPay: {
      defaultMode: "HOURLY",
      defaultFixedAmount: 0,
      defaultHourlyRate: 30,
      defaultHoursPerInspection: 1,
    },
  })),
}));

const CLEANER = { id: "c1", name: "Cleaner One", email: "c1@x.com", hourlyRate: 40 };
const QA = { id: "qa1", name: "QA One", email: "qa1@x.com", hourlyRate: 50 };

function inspection(over: Record<string, unknown> = {}) {
  return {
    id: "qa-a1",
    assignedToId: "qa1",
    status: "COMPLETED",
    completedAt: new Date("2026-01-15T00:00:00Z"),
    onSiteMinutes: null,
    payMode: null,
    payAmount: null,
    payHourlyRate: null,
    payHoursAllocated: null,
    payNote: null,
    paySettledAmount: null,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    job: { id: "j1", jobNumber: "J-1", property: { name: "12 Rose St", suburb: "Bondi" } },
    ...over,
  };
}

async function run(input: Record<string, unknown> = {}) {
  const { getPayrollSummary } = await import("@/lib/finance/payroll");
  return getPayrollSummary({ startDate: "2026-01-01", endDate: "2026-01-31", ...input } as any);
}

describe("getPayrollSummary — QA inspection pay", { timeout: 30000 }, () => {
  beforeEach(() => {
    userFindMany.mockReset();
    qaFindMany.mockReset();
    qaFindMany.mockResolvedValue([]);
  });

  it("pays a QA inspector for a completed inspection even though they hold no cleaner assignments", async () => {
    // 1st user query = the CLEANER roster; 2nd = the extra non-cleaner payees.
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    qaFindMany.mockResolvedValue([inspection({ payHoursAllocated: 2 })]);

    const rows = await run();
    const qaRow = rows.find((r) => r.cleaner.id === "qa1");
    expect(qaRow).toBeDefined();
    // 2h × the inspector's own $50/hr (beats the $30 settings default).
    expect(qaRow!.qaInspections.map((r) => r.amount)).toEqual([100]);
    expect(qaRow!.totals.qaInspections).toBe(100);
    expect(qaRow!.totals.grossPay).toBe(100);
    // The follow-up user lookup asks only for the id that was missing.
    expect(userFindMany.mock.calls[1][0].where.id.in).toEqual(["qa1"]);
  });

  it("adds inspection pay on top of a cleaner's job pay when the same person does both", async () => {
    userFindMany.mockResolvedValueOnce([{ ...CLEANER, id: "qa1", hourlyRate: 50 }]);
    qaFindMany.mockResolvedValue([inspection({ payHoursAllocated: 1 })]);
    const rows = await run();
    const row = rows.find((r) => r.cleaner.id === "qa1")!;
    expect(row.totals.qaInspections).toBe(50);
    expect(row.totals.grossPay).toBe(50);
    // No extra payee lookup — they are already on the cleaner roster.
    expect(userFindMany).toHaveBeenCalledTimes(1);
  });

  it("a committable run excludes inspections already settled by EITHER rail", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    await run({ excludePaidJobs: true });
    const where = qaFindMany.mock.calls[0][0].where;
    // This — not the date window — is what prevents double payment.
    expect(where.includedInPayrollRunId).toBeNull();
    expect(where.includedInCleanerInvoiceId).toBeNull();
    expect(where.status).toBe("COMPLETED");
  });

  it("the read-only period view does NOT apply the settlement filter (historical reports stay complete)", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    await run();
    const where = qaFindMany.mock.calls[0][0].where;
    expect(where.includedInPayrollRunId).toBeUndefined();
    expect(where.includedInCleanerInvoiceId).toBeUndefined();
  });

  it("shows a settled inspection at the amount that was actually paid, not a recomputed one", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    qaFindMany.mockResolvedValue([
      // The rate has since changed; the frozen figure must win.
      inspection({ payHoursAllocated: 2, paySettledAmount: 64, includedInPayrollRunId: "run-old" }),
    ]);
    const rows = await run();
    expect(rows.find((r) => r.cleaner.id === "qa1")!.qaInspections[0].amount).toBe(64);
  });

  it("pays an inspection the inspector picked up themselves (assignedToId is null)", async () => {
    // The regression: /pickup, the on-site timer and the submit path all stamp
    // ONLY pickedUpById. Payroll keyed on assignedToId, so this inspection was
    // real completed work that could never be paid on any run.
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    qaFindMany.mockResolvedValue([
      inspection({ assignedToId: null, pickedUpById: "qa1", payHoursAllocated: 2 }),
    ]);

    const rows = await run();
    const qaRow = rows.find((r) => r.cleaner.id === "qa1");
    expect(qaRow).toBeDefined();
    expect(qaRow!.qaInspections.map((r) => r.amount)).toEqual([100]);
  });

  it("attributes to the performer, not the assignee, when the two differ", async () => {
    // Assigned to qa2 but actually inspected by qa1 — paying the assignee would
    // pay someone who never did the work.
    userFindMany
      .mockResolvedValueOnce([CLEANER])
      .mockResolvedValueOnce([QA, { id: "qa2", name: "QA Two", email: "qa2@x.com", hourlyRate: 20 }]);
    qaFindMany.mockResolvedValue([
      inspection({ assignedToId: "qa2", pickedUpById: "qa1", payHoursAllocated: 2 }),
    ]);

    const rows = await run();
    expect(rows.find((r) => r.cleaner.id === "qa1")!.qaInspections).toHaveLength(1);
    expect(rows.find((r) => r.cleaner.id === "qa2")?.qaInspections ?? []).toEqual([]);
  });

  it("drops a $0 inspection rather than listing an empty payable line", async () => {
    userFindMany.mockResolvedValueOnce([CLEANER]).mockResolvedValueOnce([QA]);
    qaFindMany.mockResolvedValue([inspection({ payMode: "NONE" })]);
    const rows = await run();
    const qaRow = rows.find((r) => r.cleaner.id === "qa1")!;
    expect(qaRow.qaInspections).toEqual([]);
    expect(qaRow.totals.grossPay).toBe(0);
  });

  it("queries COMPLETED inspections that have a payee on EITHER column", async () => {
    // Previously this required `assignedToId: { not: null }`, which silently
    // excluded every inspection an inspector picked up themselves — those rows
    // carry their payee on `pickedUpById` and were never paid on any run.
    userFindMany.mockResolvedValueOnce([CLEANER]);
    await run();
    const where = qaFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("COMPLETED");
    expect(where.OR).toEqual([{ pickedUpById: { not: null } }, { assignedToId: { not: null } }]);
  });

  it("attributes each inspection to its own inspector only", async () => {
    userFindMany
      .mockResolvedValueOnce([CLEANER])
      .mockResolvedValueOnce([QA, { id: "qa2", name: "QA Two", email: "qa2@x.com", hourlyRate: 20 }]);
    qaFindMany.mockResolvedValue([
      inspection({ id: "i1", assignedToId: "qa1", payHoursAllocated: 1 }),
      inspection({ id: "i2", assignedToId: "qa2", payHoursAllocated: 1 }),
    ]);
    const rows = await run();
    expect(rows.find((r) => r.cleaner.id === "qa1")!.totals.qaInspections).toBe(50);
    expect(rows.find((r) => r.cleaner.id === "qa2")!.totals.qaInspections).toBe(20);
    expect(rows.find((r) => r.cleaner.id === "c1")!.totals.qaInspections).toBe(0);
  });
});
