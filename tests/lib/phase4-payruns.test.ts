import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * PHASE-4 PAY RUNS — the secondary settlement rail (lib/phase4/payruns.ts).
 *
 * This rail pays `invoice.estimatedPay`, which includes approved pay adjustments
 * and completed QA inspections as well as cleaning jobs. It used to stamp ONLY
 * `Job.payrollRunId`, so every adjustment and every inspection it paid stayed
 * "unsettled" — and the primary payroll engine (lib/payroll/engine.ts) or the
 * payee's next cleaner invoice, which both select "approved/completed AND
 * unsettled", paid the same money a SECOND time.
 *
 * It also selected payees as `role: CLEANER AND has a job assignment in the
 * window`, so a QA inspector (who holds no cleaner assignments) and a cleaner
 * whose period contained only an inspection or an adjustment were never paid at
 * all.
 *
 * These are real staff wages: every rule below is pinned.
 */

// ── db mock ────────────────────────────────────────────────────────────────
let storedValue: unknown = null;

const appSettingFindUnique = vi.fn(async () => (storedValue ? { key: "k", value: storedValue } : null));
const appSettingUpsert = vi.fn(async (args: any) => {
  storedValue = args.update?.value ?? args.create?.value;
  return {};
});
const userFindMany = vi.fn(async (_args?: any) => [] as any[]);
const qaFindMany = vi.fn(async (_args?: any) => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);
const jobUpdateMany = vi.fn(async (_args?: any) => ({ count: 0 }));
const adjUpdateMany = vi.fn(async (_args?: any) => ({ count: 0 }));
const qaUpdateMany = vi.fn(async (_args?: any) => ({ count: 0 }));
const shoppingFindMany = vi.fn(async (_args?: any) => [] as any[]);
const shoppingUpdateMany = vi.fn(async (_args?: any) => ({ count: 0 }));

const dbMock: any = {
  appSetting: { findUnique: appSettingFindUnique, upsert: appSettingUpsert },
  user: { findMany: userFindMany },
  qaAssignment: { findMany: qaFindMany, updateMany: qaUpdateMany },
  cleanerPayAdjustment: { findMany: adjFindMany, updateMany: adjUpdateMany },
  shoppingSettlement: { findMany: shoppingFindMany, updateMany: shoppingUpdateMany },
  job: { updateMany: jobUpdateMany },
  $transaction: async (fn: (tx: any) => Promise<any>) => fn(dbMock),
};

vi.mock("@/lib/db", () => ({ db: dbMock }));

const getCleanerInvoiceData = vi.fn(async (_options?: any) => invoice());
vi.mock("@/lib/cleaner/invoice", () => ({
  getCleanerInvoiceData: (options: any) => getCleanerInvoiceData(options),
}));

// ── fixtures ───────────────────────────────────────────────────────────────
function invoice(over: Record<string, unknown> = {}) {
  return {
    cleanerName: "Cleaner One",
    cleanerEmail: "c1@example.com",
    payeeRole: "CLEANER",
    hours: 0,
    estimatedPay: 0,
    rows: [] as Array<{ jobId: string }>,
    qaInspectionRows: [] as Array<{ assignmentId: string; amount: number }>,
    includedQaAssignmentIds: [] as string[],
    includedAdjustmentIds: [] as string[],
    expenseRows: [] as Array<{ runId: string; amount: number }>,
    shoppingTimeRows: [] as Array<{ runId: string; amount: number }>,
    ...over,
  } as any;
}

/** A cleaner with one $100 clean. */
function cleanJobInvoice(over: Record<string, unknown> = {}) {
  return invoice({
    hours: 2,
    estimatedPay: 100,
    rows: [{ jobId: "job1" }],
    ...over,
  });
}

async function mod() {
  return import("@/lib/phase4/payruns");
}

beforeEach(() => {
  storedValue = null;
  vi.clearAllMocks();
  userFindMany.mockResolvedValue([]);
  qaFindMany.mockResolvedValue([]);
  adjFindMany.mockResolvedValue([]);
  jobUpdateMany.mockResolvedValue({ count: 0 });
  adjUpdateMany.mockResolvedValue({ count: 0 });
  qaUpdateMany.mockResolvedValue({ count: 0 });
  shoppingFindMany.mockResolvedValue([]);
  shoppingUpdateMany.mockResolvedValue({ count: 0 });
  getCleanerInvoiceData.mockImplementation(async () => invoice());
});

// ═══════════════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════════════
describe("phase4 pay runs — pure line building", () => {
  it("aggregates and dedupes all three id streams across payees", async () => {
    const { buildComputedLines } = await mod();
    const computed = buildComputedLines([
      {
        payeeId: "u1",
        invoice: invoice({
          estimatedPay: 150,
          rows: [{ jobId: "j1" }, { jobId: "j2" }],
          includedAdjustmentIds: ["a1", "shared-a"],
          qaInspectionRows: [{ assignmentId: "q1", amount: 40 }],
          includedQaAssignmentIds: ["q1"],
        }),
      },
      {
        payeeId: "u2",
        invoice: invoice({
          cleanerName: "Zed",
          estimatedPay: 60,
          // Same adjustment id appearing twice must be stamped once.
          includedAdjustmentIds: ["shared-a", "a2"],
          qaInspectionRows: [{ assignmentId: "q2", amount: 60 }],
          includedQaAssignmentIds: ["q2"],
        }),
      },
    ]);
    expect(computed.jobIds.sort()).toEqual(["j1", "j2"]);
    expect(computed.adjustmentIds.sort()).toEqual(["a1", "a2", "shared-a"]);
    expect(computed.qaAssignmentIds.sort()).toEqual(["q1", "q2"]);
    expect(computed.lines).toHaveLength(2);
  });

  it("threads the per-inspection amount through rather than recomputing it", async () => {
    const { buildComputedLines } = await mod();
    const computed = buildComputedLines([
      {
        payeeId: "u1",
        invoice: invoice({
          estimatedPay: 87.5,
          // A FROZEN amount from an earlier settlement — must survive verbatim.
          qaInspectionRows: [{ assignmentId: "q1", amount: 87.5 }],
          includedQaAssignmentIds: ["q1"],
        }),
      },
    ]);
    expect(computed.qaAssignmentAmounts).toEqual([{ id: "q1", amount: 87.5 }]);
  });

  it("admits inspection-only and adjustment-only payees but still skips an empty one", async () => {
    const { buildComputedLines, payeeHasPayableWork } = await mod();
    const inspectionOnly = invoice({
      cleanerName: "Inspector",
      estimatedPay: 90,
      qaInspectionRows: [{ assignmentId: "q1", amount: 90 }],
      includedQaAssignmentIds: ["q1"],
    });
    const adjustmentOnly = invoice({
      cleanerName: "Adj Only",
      estimatedPay: 25,
      includedAdjustmentIds: ["a1"],
    });
    const empty = invoice({ cleanerName: "Nobody" });
    expect(payeeHasPayableWork(inspectionOnly)).toBe(true);
    expect(payeeHasPayableWork(adjustmentOnly)).toBe(true);
    expect(payeeHasPayableWork(empty)).toBe(false);

    const computed = buildComputedLines([
      { payeeId: "qa1", payeeRole: "QA_INSPECTOR", invoice: inspectionOnly },
      { payeeId: "c2", invoice: adjustmentOnly },
      { payeeId: "c3", invoice: empty },
    ]);
    expect(computed.lines.map((l) => l.cleanerId)).toEqual(["c2", "qa1"]); // name-sorted
    expect(computed.lines.find((l) => l.cleanerId === "qa1")).toMatchObject({
      payeeRole: "QA_INSPECTOR",
      jobsCount: 0,
      inspectionsCount: 1,
      amount: 90,
    });
  });

  it("keeps a net-negative payee (deduction only) as a real line", async () => {
    const { buildComputedLines } = await mod();
    const computed = buildComputedLines([
      {
        payeeId: "c1",
        invoice: invoice({ estimatedPay: -30, includedAdjustmentIds: ["d1"] }),
      },
    ]);
    expect(computed.lines).toHaveLength(1);
    expect(computed.lines[0].amount).toBe(-30);
    expect(computed.adjustmentIds).toEqual(["d1"]);
  });

  it("merges payee rosters without duplicating or reordering", async () => {
    const { mergePayeeIds } = await mod();
    expect(mergePayeeIds(["a", "b"], ["b", "c", "c"])).toEqual(["a", "b", "c"]);
    expect(mergePayeeIds([], ["qa1"])).toEqual(["qa1"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG 1 — stamping
// ═══════════════════════════════════════════════════════════════════════════
describe("createPayRun — stamps every stream it pays", () => {
  beforeEach(() => {
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
  });

  it("stamps jobs, adjustments AND inspections in one transaction, freezing the paid amount", async () => {
    getCleanerInvoiceData.mockImplementation(async () =>
      cleanJobInvoice({
        estimatedPay: 165,
        includedAdjustmentIds: ["a1"],
        qaInspectionRows: [{ assignmentId: "q1", amount: 40 }],
        includedQaAssignmentIds: ["q1"],
      })
    );
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });

    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["job1"] }, payrollRunId: null },
      data: { payrollRunId: run.id },
    });
    // Guarded on BOTH stamps so a concurrent invoice can't be robbed.
    expect(adjUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["a1"] },
        includedInPayrollRunId: null,
        includedInCleanerInvoiceId: null,
      },
      data: { includedInPayrollRunId: run.id },
    });
    const qaCall = qaUpdateMany.mock.calls[0][0];
    expect(qaCall.where).toEqual({
      id: "q1",
      includedInPayrollRunId: null,
      includedInCleanerInvoiceId: null,
    });
    expect(qaCall.data.includedInPayrollRunId).toBe(run.id);
    expect(qaCall.data.includedInPayrollRunAt).toBeInstanceOf(Date);
    // The FROZEN figure is what this run paid — not a recomputation.
    expect(qaCall.data.paySettledAmount).toBe(40);
  });

  it("an inspection this run paid is no longer payable by the primary engine or the next invoice", async () => {
    getCleanerInvoiceData.mockImplementation(async () =>
      cleanJobInvoice({
        estimatedPay: 140,
        qaInspectionRows: [{ assignmentId: "q1", amount: 40 }],
        includedQaAssignmentIds: ["q1"],
      })
    );
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });
    const { isQaAssignmentAvailableForSettlement } = await import("@/lib/finance/qa-pay");

    // Reconstruct the row exactly as the stamp left it.
    const stamped = {
      id: "q1",
      status: "COMPLETED",
      includedInPayrollRunId: qaUpdateMany.mock.calls[0][0].data.includedInPayrollRunId,
      includedInCleanerInvoiceId: null,
    };
    expect(stamped.includedInPayrollRunId).toBe(run.id);
    // Invisible to a fresh selection on EITHER rail…
    expect(isQaAssignmentAvailableForSettlement(stamped, {})).toBe(false);
    expect(isQaAssignmentAvailableForSettlement(stamped, { includeInvoiceId: "inv-9" })).toBe(false);
    expect(isQaAssignmentAvailableForSettlement(stamped, { includePayrollRunId: "run-9" })).toBe(false);
    // …and visible only to the run that paid it.
    expect(isQaAssignmentAvailableForSettlement(stamped, { includePayrollRunId: run.id })).toBe(true);
  });

  it("an adjustment this run paid is no longer payable by the primary engine or the next invoice", async () => {
    getCleanerInvoiceData.mockImplementation(async () =>
      cleanJobInvoice({ estimatedPay: 125, includedAdjustmentIds: ["a1"] })
    );
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });
    const { isAdjustmentAvailableForInvoice } = await import("@/lib/finance/pay-adjustments");
    const stamped = {
      id: "a1",
      status: "APPROVED",
      approvedAmount: 25,
      includedInPayrollRunId: adjUpdateMany.mock.calls[0][0].data.includedInPayrollRunId,
      includedInCleanerInvoiceId: null,
    };
    expect(stamped.includedInPayrollRunId).toBe(run.id);
    expect(isAdjustmentAvailableForInvoice(stamped, {})).toBe(false);
    expect(isAdjustmentAvailableForInvoice(stamped, { includeInvoiceId: "inv-9" })).toBe(false);
    expect(isAdjustmentAvailableForInvoice(stamped, { includePayrollRunId: run.id })).toBe(true);
  });

  it("writes no stamps for a stream it did not pay", async () => {
    getCleanerInvoiceData.mockImplementation(async () => cleanJobInvoice());
    const { createPayRun } = await mod();
    await createPayRun({ startDate: "2026-01-01", endDate: "2026-01-31", createdByUserId: "admin" });
    expect(jobUpdateMany).toHaveBeenCalledTimes(1);
    expect(adjUpdateMany).not.toHaveBeenCalled();
    expect(qaUpdateMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG 2 — payee selection
// ═══════════════════════════════════════════════════════════════════════════
describe("createPayRun — payee selection", () => {
  it("widens the assignment query to the invoice rail's payee roles", async () => {
    userFindMany.mockResolvedValueOnce([]);
    const { createPayRun } = await mod();
    await createPayRun({ startDate: "2026-01-01", endDate: "2026-01-31", createdByUserId: "admin" });
    const where = userFindMany.mock.calls[0][0].where;
    expect(where.role).toEqual({ in: ["CLEANER", "QA_INSPECTOR"] });
    expect(where.isActive).toBe(true);
    // Only a CURRENT assignment earns discovery (matches the invoice query).
    expect(where.jobAssignments.some.removedAt).toBeNull();
  });

  it("pays a QA inspector who holds no cleaner assignments at all", async () => {
    // No assignment-driven payees; the inspector is discovered via QaAssignment.
    userFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "qa1" }]);
    qaFindMany.mockResolvedValue([{ assignedToId: "qa1" }]);
    getCleanerInvoiceData.mockImplementation(async () =>
      invoice({
        cleanerName: "Inspector Ann",
        cleanerEmail: "ann@example.com",
        payeeRole: "QA_INSPECTOR",
        estimatedPay: 90,
        qaInspectionRows: [
          { assignmentId: "q1", amount: 50 },
          { assignmentId: "q2", amount: 40 },
        ],
        includedQaAssignmentIds: ["q1", "q2"],
      })
    );
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });

    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toMatchObject({
      cleanerId: "qa1",
      payeeRole: "QA_INSPECTOR",
      jobsCount: 0,
      inspectionsCount: 2,
      amount: 90,
    });
    expect(run.totals.amount).toBe(90);
    // Both inspections stamped, each frozen at its own amount.
    expect(qaUpdateMany.mock.calls.map((c) => [c[0].where.id, c[0].data.paySettledAmount])).toEqual([
      ["q1", 50],
      ["q2", 40],
    ]);
    // The extra-payee lookup only asks for the missing id, and still requires an
    // active user in a payee role.
    const extraWhere = userFindMany.mock.calls[1][0].where;
    expect(extraWhere.id.in).toEqual(["qa1"]);
    expect(extraWhere.isActive).toBe(true);
    expect(extraWhere.role).toEqual({ in: ["CLEANER", "QA_INSPECTOR"] });
  });

  it("pays a cleaner whose period contains only an approved adjustment", async () => {
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "c9" }]);
    adjFindMany.mockResolvedValue([{ cleanerId: "c9" }]);
    getCleanerInvoiceData.mockImplementation(async () =>
      invoice({
        cleanerName: "Carry Over",
        cleanerEmail: "c9@example.com",
        estimatedPay: 45,
        includedAdjustmentIds: ["a9"],
      })
    );
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toMatchObject({ cleanerId: "c9", jobsCount: 0, adjustmentsCount: 1, amount: 45 });
    expect(adjUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a9"] }, includedInPayrollRunId: null, includedInCleanerInvoiceId: null },
      data: { includedInPayrollRunId: run.id },
    });
  });

  it("still skips a payee with nothing payable", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () => invoice());
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });
    expect(run.lines).toHaveLength(0);
    expect(run.totals).toMatchObject({ cleaners: 0, jobs: 0, amount: 0 });
    expect(jobUpdateMany).not.toHaveBeenCalled();
    expect(adjUpdateMany).not.toHaveBeenCalled();
    expect(qaUpdateMany).not.toHaveBeenCalled();
  });

  it("does not run the extra-payee lookup when every payee already has assignments", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    qaFindMany.mockResolvedValue([{ assignedToId: "u1" }]);
    adjFindMany.mockResolvedValue([{ cleanerId: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () => cleanJobInvoice());
    const { createPayRun } = await mod();
    await createPayRun({ startDate: "2026-01-01", endDate: "2026-01-31", createdByUserId: "admin" });
    expect(userFindMany).toHaveBeenCalledTimes(1);
  });

  it("discovers unsettled payees with no lower date bound (the stamp, not the window, prevents double pay)", async () => {
    userFindMany.mockResolvedValueOnce([]);
    const { createPayRun } = await mod();
    await createPayRun({ startDate: "2026-01-01", endDate: "2026-01-31", createdByUserId: "admin" });

    const qaWhere = qaFindMany.mock.calls[0][0].where;
    expect(qaWhere.status).toBe("COMPLETED");
    expect(qaWhere.includedInCleanerInvoiceId).toBeNull();
    expect(qaWhere.AND[0].OR[0].completedAt.lte).toBeInstanceOf(Date);
    expect(qaWhere.AND[0].OR[0].completedAt.gte).toBeUndefined();
    expect(qaWhere.AND[1]).toEqual({ includedInPayrollRunId: null });

    const adjWhere = adjFindMany.mock.calls[0][0].where;
    expect(adjWhere.status).toBe("APPROVED");
    expect(adjWhere.includedInCleanerInvoiceId).toBeNull();
    expect(adjWhere.AND).toEqual([{ includedInPayrollRunId: null }]);
    // A window here would hide a late-approved adjustment from every run forever.
    expect(adjWhere.reviewedAt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// refresh
// ═══════════════════════════════════════════════════════════════════════════
describe("refreshPayRun", () => {
  async function seed(lines: any[] = []) {
    storedValue = {
      version: 3,
      data: {
        runs: [
          {
            id: "run-1",
            name: "Pay Run",
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            status: "DRAFT",
            lines,
            createdByUserId: "admin",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    };
  }

  it("re-evaluates its OWN rows instead of dropping them", async () => {
    await seed();
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () =>
      cleanJobInvoice({
        estimatedPay: 165,
        includedAdjustmentIds: ["a1"],
        qaInspectionRows: [{ assignmentId: "q1", amount: 40 }],
        includedQaAssignmentIds: ["q1"],
      })
    );
    const { refreshPayRun } = await mod();
    const updated = await refreshPayRun("run-1", "admin");

    // The recompute un-excludes this run's own rows across all three streams.
    expect(getCleanerInvoiceData.mock.calls[0][0]).toMatchObject({
      excludePaidJobs: true,
      includePaidRunId: "run-1",
    });
    expect(updated!.lines[0].amount).toBe(165);

    // Kept rows are NOT released…
    expect(jobUpdateMany.mock.calls[0][0]).toEqual({
      where: { payrollRunId: "run-1", id: { notIn: ["job1"] } },
      data: { payrollRunId: null },
    });
    expect(adjUpdateMany.mock.calls[0][0]).toEqual({
      where: { includedInPayrollRunId: "run-1", id: { notIn: ["a1"] } },
      data: { includedInPayrollRunId: null },
    });
    expect(qaUpdateMany.mock.calls[0][0]).toEqual({
      where: { includedInPayrollRunId: "run-1", id: { notIn: ["q1"] } },
      data: {
        includedInPayrollRunId: null,
        includedInPayrollRunAt: null,
        paySettledAmount: null,
      },
    });
    // …and are (re)claimed, re-freezing the amount the refreshed line pays.
    const reclaim = qaUpdateMany.mock.calls[1][0];
    expect(reclaim.where.OR).toEqual([
      { includedInPayrollRunId: null },
      { includedInPayrollRunId: "run-1" },
    ]);
    expect(reclaim.where.includedInCleanerInvoiceId).toBeNull();
    expect(reclaim.data.paySettledAmount).toBe(40);
  });

  it("releases rows that dropped out of the run", async () => {
    await seed();
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    // Nothing is included any more.
    getCleanerInvoiceData.mockImplementation(async () => invoice());
    const { refreshPayRun } = await mod();
    const updated = await refreshPayRun("run-1", "admin");
    expect(updated!.lines).toHaveLength(0);

    // With no keepers, the release clauses carry NO notIn — everything goes back.
    expect(jobUpdateMany.mock.calls[0][0]).toEqual({
      where: { payrollRunId: "run-1" },
      data: { payrollRunId: null },
    });
    expect(adjUpdateMany.mock.calls[0][0]).toEqual({
      where: { includedInPayrollRunId: "run-1" },
      data: { includedInPayrollRunId: null },
    });
    expect(qaUpdateMany.mock.calls[0][0].where).toEqual({ includedInPayrollRunId: "run-1" });
    expect(qaUpdateMany.mock.calls[0][0].data.paySettledAmount).toBeNull();
    // No re-claim happened.
    expect(qaUpdateMany).toHaveBeenCalledTimes(1);
    expect(adjUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("refuses to refresh a LOCKED run (its stamps are final)", async () => {
    await seed();
    (storedValue as any).data.runs[0].status = "LOCKED";
    const { refreshPayRun } = await mod();
    await expect(refreshPayRun("run-1", "admin")).rejects.toThrow(/Only draft/i);
    expect(qaUpdateMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// delete
// ═══════════════════════════════════════════════════════════════════════════
describe("deletePayRun", () => {
  beforeEach(() => {
    storedValue = {
      version: 5,
      data: {
        runs: [
          {
            id: "run-1",
            name: "Pay Run",
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            status: "DRAFT",
            lines: [
              {
                cleanerId: "u1",
                cleanerName: "Cleaner One",
                cleanerEmail: "c1@example.com",
                jobsCount: 1,
                paidHours: 2,
                amount: 165,
              },
            ],
            createdByUserId: "admin",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    };
  });

  it("releases all three streams and clears the frozen inspection amount", async () => {
    const { deletePayRun } = await mod();
    expect(await deletePayRun("run-1")).toBe(true);

    expect(jobUpdateMany).toHaveBeenCalledWith({
      where: { payrollRunId: "run-1" },
      data: { payrollRunId: null },
    });
    expect(adjUpdateMany).toHaveBeenCalledWith({
      where: { includedInPayrollRunId: "run-1" },
      data: { includedInPayrollRunId: null },
    });
    expect(qaUpdateMany).toHaveBeenCalledWith({
      where: { includedInPayrollRunId: "run-1" },
      data: {
        includedInPayrollRunId: null,
        // The frozen figure belonged to the deleted run — it must not survive to
        // override the next rail's own computation.
        includedInPayrollRunAt: null,
        paySettledAmount: null,
      },
    });
    expect((storedValue as any).data.runs).toHaveLength(0);
  });

  it("a released inspection and adjustment become payable again", async () => {
    const { deletePayRun } = await mod();
    await deletePayRun("run-1");
    const { isQaAssignmentAvailableForSettlement } = await import("@/lib/finance/qa-pay");
    const { isAdjustmentAvailableForInvoice } = await import("@/lib/finance/pay-adjustments");
    const released = qaUpdateMany.mock.calls[0][0].data;
    expect(
      isQaAssignmentAvailableForSettlement({ status: "COMPLETED", ...released }, {})
    ).toBe(true);
    expect(
      isAdjustmentAvailableForInvoice({
        status: "APPROVED",
        approvedAmount: 25,
        ...adjUpdateMany.mock.calls[0][0].data,
      })
    ).toBe(true);
  });

  it("refuses to delete a PAID run", async () => {
    (storedValue as any).data.runs[0].status = "PAID";
    const { deletePayRun } = await mod();
    await expect(deletePayRun("run-1")).rejects.toThrow(/Only draft/i);
    expect(jobUpdateMany).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SHOPPING — the fourth settlement stream
// ═══════════════════════════════════════════════════════════════════════════
/**
 * `estimatedPay` folds in shopping reimbursements AND approved shopping time,
 * and this rail pays that figure — but it used to stamp nothing for either, so
 * the payee's next cleaner invoice billed the same money all over again.
 *
 * Expense and time carry SEPARATE stamp pairs because they settle
 * independently: the primary payroll engine pays reimbursements and has never
 * paid shopping time.
 */
function shoppingInvoice(over: Record<string, unknown> = {}) {
  return invoice({
    estimatedPay: 70,
    expenseRows: [{ runId: "sr1", amount: 40 }],
    shoppingTimeRows: [{ runId: "sr1", amount: 30 }],
    ...over,
  });
}

describe("pay runs — shopping", () => {
  it("buildComputedLines collects both shopping streams, deduped, at the billed amount", async () => {
    const { buildComputedLines } = await mod();
    const computed = buildComputedLines([
      { payeeId: "u1", invoice: shoppingInvoice() },
      {
        payeeId: "u2",
        invoice: shoppingInvoice({
          cleanerName: "Zed",
          expenseRows: [{ runId: "sr2", amount: 15.005 }],
          shoppingTimeRows: [],
        }),
      },
    ]);
    expect(computed.shoppingExpenseAmounts).toEqual([
      { runId: "sr1", amount: 40 },
      { runId: "sr2", amount: 15.01 },
    ]);
    // Time is tracked on its own list — sr1 has both, sr2 has expense only.
    expect(computed.shoppingTimeAmounts).toEqual([{ runId: "sr1", amount: 30 }]);
  });

  it("a shopping-only payee earns a line (they hold no job, adjustment or inspection)", async () => {
    const { payeeHasPayableWork } = await mod();
    expect(
      payeeHasPayableWork(shoppingInvoice({ estimatedPay: 0, shoppingTimeRows: [] }) as any)
    ).toBe(true);
    expect(payeeHasPayableWork(invoice() as any)).toBe(false);
  });

  it("createPayRun stamps BOTH streams, guarded and frozen", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () => shoppingInvoice());
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });

    const [expenseCall, timeCall] = shoppingUpdateMany.mock.calls.map((call) => call[0]);
    // Keyed on the RUN id: every write path in lib/inventory/shopping-runs.ts
    // replaces the settlement row, so a settlement id would already be stale.
    expect(expenseCall.where.shoppingRunId).toBe("sr1");
    // "unstamped OR already mine" — a refresh keeps its own rows…
    expect(expenseCall.where.OR).toEqual([
      { includedInPayrollRunId: null },
      { includedInPayrollRunId: run.id },
    ]);
    // …but the OTHER rail's stamp is an absolute bar.
    expect(expenseCall.where.includedInCleanerInvoiceId).toBeNull();
    expect(expenseCall.data.includedInPayrollRunId).toBe(run.id);
    expect(expenseCall.data.includedInPayrollRunAt).toBeInstanceOf(Date);
    expect(expenseCall.data.paySettledAmount).toBe(40);

    // Time uses its OWN columns — sharing the expense stamp would write off
    // hours this rail has never actually paid.
    expect(timeCall.where.shoppingRunId).toBe("sr1");
    expect(timeCall.where.timeIncludedInCleanerInvoiceId).toBeNull();
    expect(timeCall.data.timeIncludedInPayrollRunId).toBe(run.id);
    expect(timeCall.data.timePaySettledAmount).toBe(30);
    // The expense stamp must not appear on the time write, or vice versa.
    expect(timeCall.data.includedInPayrollRunId).toBeUndefined();
    expect(expenseCall.data.timeIncludedInPayrollRunId).toBeUndefined();
  });

  it("stamped shopping is invisible to the next invoice and to another run", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () => shoppingInvoice());
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });
    const { isShoppingExpenseAvailableForSettlement, isShoppingTimeAvailableForSettlement } =
      await import("@/lib/finance/shopping-settlement");

    // Reconstruct the run exactly as the stamps left it.
    const stamped = {
      cleanerReimbursementStatus: "READY",
      shoppingTimeStatus: "APPROVED",
      expensePayrollRunId: shoppingUpdateMany.mock.calls[0][0].data.includedInPayrollRunId,
      expenseCleanerInvoiceId: null,
      timePayrollRunId: shoppingUpdateMany.mock.calls[1][0].data.timeIncludedInPayrollRunId,
      timeCleanerInvoiceId: null,
    };
    expect(stamped.expensePayrollRunId).toBe(run.id);
    expect(isShoppingExpenseAvailableForSettlement(stamped, {})).toBe(false);
    expect(isShoppingExpenseAvailableForSettlement(stamped, { includeInvoiceId: "inv-9" })).toBe(
      false
    );
    expect(isShoppingTimeAvailableForSettlement(stamped, {})).toBe(false);
    // …and visible only to the run that paid it.
    expect(
      isShoppingExpenseAvailableForSettlement(stamped, { includePayrollRunId: run.id })
    ).toBe(true);
  });

  it("writes no shopping stamps when the run pays no shopping", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () => cleanJobInvoice());
    const { createPayRun } = await mod();
    await createPayRun({ startDate: "2026-01-01", endDate: "2026-01-31", createdByUserId: "admin" });
    // deletePayRun-style release calls are the only shopping writes allowed here,
    // and createPayRun does not release.
    expect(shoppingUpdateMany).not.toHaveBeenCalled();
  });

  it("discovers a payee whose only unsettled work is a shopping run", async () => {
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "sc1" }]);
    shoppingFindMany.mockResolvedValue([{ shoppingRun: { ownerUserId: "sc1" } }]);
    getCleanerInvoiceData.mockImplementation(async () =>
      shoppingInvoice({ cleanerName: "Shopper", cleanerEmail: "s@example.com" })
    );
    const { createPayRun } = await mod();
    const run = await createPayRun({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      createdByUserId: "admin",
    });
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toMatchObject({ cleanerId: "sc1", jobsCount: 0, amount: 70 });

    // Discovery must be a SUPERSET of selection: unsettled on EITHER stream, and
    // (when recomputing) rows this run already holds still count as its own.
    const where = shoppingFindMany.mock.calls[0][0].where;
    expect(where.OR[0].AND).toEqual([
      { includedInCleanerInvoiceId: null },
      { includedInPayrollRunId: null },
    ]);
    expect(where.OR[1].AND).toEqual([
      { timeIncludedInCleanerInvoiceId: null },
      { timeIncludedInPayrollRunId: null },
    ]);
  });

  it("refreshPayRun releases the shopping it no longer pays and re-claims what it does", async () => {
    storedValue = {
      version: 3,
      data: {
        runs: [
          {
            id: "run-1",
            name: "Pay Run",
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            status: "DRAFT",
            lines: [],
            createdByUserId: "admin",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    };
    userFindMany.mockResolvedValueOnce([{ id: "u1" }]);
    getCleanerInvoiceData.mockImplementation(async () => shoppingInvoice());
    const { refreshPayRun } = await mod();
    await refreshPayRun("run-1", "admin");

    const calls = shoppingUpdateMany.mock.calls.map((call) => call[0]);
    // Release first — everything this run stamped EXCEPT what it still pays…
    expect(calls[0]).toEqual({
      where: { includedInPayrollRunId: "run-1", shoppingRunId: { notIn: ["sr1"] } },
      data: {
        includedInPayrollRunId: null,
        includedInPayrollRunAt: null,
        // The frozen figure belonged to a line this run no longer pays.
        paySettledAmount: null,
      },
    });
    expect(calls[1].where).toEqual({
      timeIncludedInPayrollRunId: "run-1",
      shoppingRunId: { notIn: ["sr1"] },
    });
    expect(calls[1].data.timePaySettledAmount).toBeNull();
    // …then re-claim, re-freezing the refreshed amounts.
    expect(calls[2].data.paySettledAmount).toBe(40);
    expect(calls[3].data.timePaySettledAmount).toBe(30);
  });

  it("deletePayRun releases both shopping streams so the money is payable again", async () => {
    storedValue = {
      version: 5,
      data: {
        runs: [
          {
            id: "run-1",
            name: "Pay Run",
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            status: "DRAFT",
            lines: [],
            createdByUserId: "admin",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        ],
      },
    };
    const { deletePayRun } = await mod();
    expect(await deletePayRun("run-1")).toBe(true);

    const calls = shoppingUpdateMany.mock.calls.map((call) => call[0]);
    // No keepers, so no notIn — everything this run held goes back.
    expect(calls[0].where).toEqual({ includedInPayrollRunId: "run-1" });
    expect(calls[1].where).toEqual({ timeIncludedInPayrollRunId: "run-1" });

    const { isShoppingExpenseAvailableForSettlement } = await import(
      "@/lib/finance/shopping-settlement"
    );
    expect(
      isShoppingExpenseAvailableForSettlement({
        cleanerReimbursementStatus: "READY",
        expensePayrollRunId: calls[0].data.includedInPayrollRunId,
        expenseCleanerInvoiceId: null,
      })
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// stored-run compatibility
// ═══════════════════════════════════════════════════════════════════════════
describe("stored-run parsing stays backward compatible", () => {
  it("reads a legacy line (no payeeRole / counts) without dropping it", async () => {
    storedValue = {
      version: 2,
      data: {
        runs: [
          {
            id: "legacy",
            name: "Old Run",
            periodStart: "2025-12-01",
            periodEnd: "2025-12-31",
            status: "PAID",
            createdByUserId: "admin",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            lines: [
              { cleanerId: "u1", cleanerName: "Old Name", cleanerEmail: "old@x.com", jobsCount: 3, paidHours: 6, amount: 300 },
            ],
          },
        ],
      },
    };
    const { getPayRunById } = await mod();
    const run = await getPayRunById("legacy");
    expect(run).not.toBeNull();
    expect(run!.lines[0]).toMatchObject({
      cleanerId: "u1",
      cleanerName: "Old Name",
      jobsCount: 3,
      amount: 300,
      // New fields default rather than invalidating the line.
      payeeRole: null,
      inspectionsCount: 0,
      adjustmentsCount: 0,
    });
    expect(run!.totals.amount).toBe(300);
  });

  it("round-trips payeeRole and does NOT clamp a negative amount to zero", async () => {
    storedValue = {
      version: 2,
      data: {
        runs: [
          {
            id: "r2",
            name: "Run",
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            status: "DRAFT",
            createdByUserId: "admin",
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
            lines: [
              {
                cleanerId: "qa1",
                cleanerName: "Inspector",
                cleanerEmail: "qa@x.com",
                payeeRole: "QA_INSPECTOR",
                jobsCount: 0,
                inspectionsCount: 2,
                adjustmentsCount: 1,
                paidHours: 0,
                amount: -30,
              },
            ],
          },
        ],
      },
    };
    const { getPayRunById } = await mod();
    const run = await getPayRunById("r2");
    expect(run!.lines[0].payeeRole).toBe("QA_INSPECTOR");
    // Clamping here silently deleted deductions — see lib/finance/pay-adjustments.ts.
    expect(run!.lines[0].amount).toBe(-30);
    expect(run!.totals.amount).toBe(-30);
  });
});
