import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * QA inspection pay on the CLEANER INVOICE rail.
 *
 * The invoice is the second of the two settlement rails that can consume a
 * completed inspection (the other being a payroll run). This suite pins the
 * rules that keep real staff money correct:
 *
 *  • an unsettled inspection reaches the next invoice exactly once;
 *  • an inspection a payroll run already paid NEVER reaches an invoice, and an
 *    inspection an invoice already billed NEVER reaches a payroll run;
 *  • re-rendering an existing invoice keeps its OWN inspections visible at the
 *    frozen amount it billed;
 *  • an inspections-only payee (a QA inspector holds no cleaner assignments)
 *    gets a complete, correctly totalled invoice that does not read as if their
 *    cleans went missing;
 *  • a frozen paySettledAmount always beats a later rate change;
 *  • CANCELLED / not-yet-completed inspections are never paid.
 */

const jobFindMany = vi.fn(async () => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);
const qaFindMany = vi.fn(async (_args?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        name: "Inspector",
        email: "qa@example.com",
        phone: "0400 000 000",
        address: null,
        suburb: null,
        state: null,
        postcode: null,
        abn: "12 345 678 901",
        hourlyRate: 50,
        bankBsb: "062-000",
        bankAccountNumber: "12345678",
        bankAccountName: "Inspector",
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

function inspection(over: Record<string, unknown> = {}) {
  return {
    id: "qa-a1",
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
    job: { id: "j9", jobNumber: "J-9", property: { name: "12 Rose St" } },
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

function qaWhere() {
  return qaFindMany.mock.calls[0][0].where as Record<string, any>;
}

describe("cleaner invoice — QA inspection pay", { timeout: 30000 }, () => {
  beforeEach(() => {
    jobFindMany.mockReset();
    adjFindMany.mockReset();
    qaFindMany.mockReset();
    jobFindMany.mockResolvedValue([]);
    adjFindMany.mockResolvedValue([]);
    qaFindMany.mockResolvedValue([]);
  });

  // ── Selection ────────────────────────────────────────────────────────
  it("selects only this payee's COMPLETED, unsettled inspections — payroll-stamped rows are excluded at the query", async () => {
    await build();
    const where = qaWhere();
    expect(where.assignedToId).toBe("u1");
    expect(where.status).toBe("COMPLETED");
    // The cross-rail half of the guard: a payroll run already paid these.
    expect(where.includedInPayrollRunId).toBeNull();
    expect(where.AND).toContainEqual({ includedInCleanerInvoiceId: null });
  });

  it("windows on the period END only — no lower bound, so a late-settled inspection is still paid", async () => {
    await build();
    const dateClause = qaWhere().AND[0];
    // Upper bound keeps a post-period inspection off an earlier invoice…
    expect(dateClause.OR[0].completedAt.lte).toBeInstanceOf(Date);
    expect(dateClause.OR[0].completedAt.gte).toBeUndefined();
    // …and a COMPLETED row with no completedAt is owed money, not dropped.
    expect(dateClause.OR[1]).toEqual({ completedAt: null });
  });

  it("keeps its OWN inspections selectable when recomputing an existing invoice", async () => {
    await build({ includeInvoiceId: "inv1" });
    expect(qaWhere().AND).toContainEqual({
      OR: [
        { includedInCleanerInvoiceId: null },
        { includedInCleanerInvoiceId: "inv1" },
      ],
    });
  });

  // ── Pricing + totals ─────────────────────────────────────────────────
  it("bills an unsettled inspection exactly once and reports its id for stamping", async () => {
    qaFindMany.mockResolvedValue([inspection({ payHoursAllocated: 2 })]);
    const data = await build();
    expect(data.qaInspectionRows).toHaveLength(1);
    // 2h × the inspector's own $50/hr (beats the $30 settings default).
    expect(data.qaInspectionRows[0].amount).toBe(100);
    expect(data.qaInspectionRows[0].property).toBe("12 Rose St");
    expect(data.qaInspectionTotal).toBe(100);
    expect(data.includedQaAssignmentIds).toEqual(["qa-a1"]);
  });

  it("an inspections-only payee (no cleaning jobs at all) gets a correct, complete invoice", async () => {
    jobFindMany.mockResolvedValue([]);
    qaFindMany.mockResolvedValue([
      inspection({ id: "i1", payHoursAllocated: 1.5 }),
      inspection({ id: "i2", payMode: "FIXED", payAmount: 45 }),
    ]);
    const data = await build();
    expect(data.rows).toHaveLength(0);
    expect(data.qaInspectionTotal).toBe(120); // 1.5×50 + 45
    expect(data.estimatedPay).toBe(120);
    expect(data.includedQaAssignmentIds).toEqual(["i1", "i2"]);
  });

  it("totals jobs + inspections together on a mixed invoice", async () => {
    jobFindMany.mockResolvedValue([job()]);
    qaFindMany.mockResolvedValue([inspection({ payHoursAllocated: 2 })]);
    const data = await build();
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].amount).toBe(100); // 2h × $50
    expect(data.qaInspectionTotal).toBe(100);
    expect(data.estimatedPay).toBe(200);
  });

  it("adds inspection pay on top of adjustments, expenses and job pay without disturbing them", async () => {
    jobFindMany.mockResolvedValue([job()]);
    adjFindMany
      .mockResolvedValueOnce([
        {
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
        },
      ])
      .mockResolvedValueOnce([]);
    qaFindMany.mockResolvedValue([inspection({ payMode: "FIXED", payAmount: 60 })]);
    const data = await build();
    expect(data.estimatedPay).toBe(185); // 100 job + 25 extra + 60 inspection
    expect(data.includedAdjustmentIds).toEqual(["a1"]);
    expect(data.includedQaAssignmentIds).toEqual(["qa-a1"]);
  });

  // ── Double-pay guard ─────────────────────────────────────────────────
  it("never bills an inspection a PAYROLL RUN already paid, even if the query leaks one", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ payHoursAllocated: 2, includedInPayrollRunId: "run-7", paySettledAmount: 100 }),
    ]);
    const data = await build();
    expect(data.qaInspectionRows).toHaveLength(0);
    expect(data.includedQaAssignmentIds).toHaveLength(0);
    expect(data.estimatedPay).toBe(0);
  });

  it("never bills an inspection ANOTHER invoice already billed", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ payHoursAllocated: 2, includedInCleanerInvoiceId: "inv-old", paySettledAmount: 100 }),
    ]);
    const data = await build();
    expect(data.qaInspectionRows).toHaveLength(0);
    expect(data.estimatedPay).toBe(0);
  });

  it("BOTH directions of the cross-rail guard hold (invoice↔payroll)", async () => {
    const { isQaAssignmentAvailableForSettlement } = await import("@/lib/finance/qa-pay");
    const invoiced = { status: "COMPLETED", includedInCleanerInvoiceId: "inv-1" };
    const paid = { status: "COMPLETED", includedInPayrollRunId: "run-1" };
    // An invoice-stamped inspection is invisible to the next payroll run…
    expect(isQaAssignmentAvailableForSettlement(invoiced, {})).toBe(false);
    expect(isQaAssignmentAvailableForSettlement(invoiced, { includePayrollRunId: "run-2" })).toBe(false);
    // …and a payroll-stamped one is invisible to the next invoice.
    expect(isQaAssignmentAvailableForSettlement(paid, {})).toBe(false);
    expect(isQaAssignmentAvailableForSettlement(paid, { includeInvoiceId: "inv-2" })).toBe(false);
    // Only the very run/invoice that stamped it may see it again.
    expect(isQaAssignmentAvailableForSettlement(invoiced, { includeInvoiceId: "inv-1" })).toBe(true);
    expect(isQaAssignmentAvailableForSettlement(paid, { includePayrollRunId: "run-1" })).toBe(true);
  });

  // ── Recompute safety + frozen amounts ────────────────────────────────
  it("recomputing an invoice keeps its own inspections at the FROZEN amount it billed", async () => {
    qaFindMany.mockResolvedValue([
      // The rate has since doubled; the invoice must still read $64.
      inspection({
        payHoursAllocated: 2,
        payHourlyRate: 500,
        includedInCleanerInvoiceId: "inv1",
        paySettledAmount: 64,
      }),
    ]);
    const data = await build({ includeInvoiceId: "inv1" });
    expect(data.qaInspectionRows).toHaveLength(1);
    expect(data.qaInspectionRows[0].amount).toBe(64);
    expect(data.qaInspectionTotal).toBe(64);
    expect(data.includedQaAssignmentIds).toEqual(["qa-a1"]);
  });

  it("a frozen paySettledAmount beats a later rate change even before re-render", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ payHoursAllocated: 2, payHourlyRate: 999, paySettledAmount: 80 }),
    ]);
    const data = await build();
    expect(data.qaInspectionRows[0].amount).toBe(80);
  });

  // ── Exclusions ───────────────────────────────────────────────────────
  it("excludes CANCELLED and not-yet-completed inspections", async () => {
    qaFindMany.mockResolvedValue([
      inspection({ id: "c1", status: "CANCELLED", payHoursAllocated: 2 }),
      inspection({ id: "o1", status: "OPEN", payHoursAllocated: 2 }),
      inspection({ id: "p1", status: "IN_PROGRESS", payHoursAllocated: 2 }),
    ]);
    const data = await build();
    expect(data.qaInspectionRows).toHaveLength(0);
    expect(data.estimatedPay).toBe(0);
  });

  it("drops a $0 inspection rather than billing an empty line (it stays unstamped for later)", async () => {
    qaFindMany.mockResolvedValue([inspection({ payMode: "NONE" })]);
    const data = await build();
    expect(data.qaInspectionRows).toHaveLength(0);
    expect(data.includedQaAssignmentIds).toHaveLength(0);
  });

  // ── Presentation ─────────────────────────────────────────────────────
  it("renders a labelled QA section with basis + subtotal, and folds it into the total", async () => {
    const { buildCleanerInvoiceHtml } = await import("@/lib/cleaner/invoice");
    jobFindMany.mockResolvedValue([job()]);
    qaFindMany.mockResolvedValue([
      inspection({ id: "i1", payHoursAllocated: 2 }),
      inspection({ id: "i2", payMode: "FIXED", payAmount: 40, payNote: "Callback check" }),
    ]);
    const data = await build();
    const html = buildCleanerInvoiceHtml(data);
    expect(html).toContain("QA inspections");
    expect(html).toContain("12 Rose St");
    expect(html).toContain("Hourly — $50.00 × 2.00h");
    expect(html).toContain("Fixed");
    expect(html).toContain("Callback check");
    expect(html).toContain("QA inspections subtotal");
    // Both the section subtotal and the invoice total are present.
    expect(html).toContain("$140.00"); // inspections subtotal
    expect(html).toContain("$240.00"); // + the $100 clean
    // A mixed invoice still names its cleaning half.
    expect(html).toContain("Cleaning jobs");
  });

  it("an inspections-only invoice never claims there was no payable work", async () => {
    const { buildCleanerInvoiceHtml } = await import("@/lib/cleaner/invoice");
    jobFindMany.mockResolvedValue([]);
    qaFindMany.mockResolvedValue([inspection({ payHoursAllocated: 1 })]);
    const html = buildCleanerInvoiceHtml(await build());
    expect(html).toContain("QA inspections");
    expect(html).not.toContain("No payable work found");
    expect(html).not.toContain("Cleaning jobs");
  });

  it("a genuinely empty invoice still says so", async () => {
    const { buildCleanerInvoiceHtml } = await import("@/lib/cleaner/invoice");
    const html = buildCleanerInvoiceHtml(await build());
    expect(html).toContain("No payable work found");
  });

  it("hiding hours hides the inspection hours too — no hour may leak through the basis text", async () => {
    const { buildCleanerInvoiceHtml } = await import("@/lib/cleaner/invoice");
    qaFindMany.mockResolvedValue([inspection({ payHoursAllocated: 2 })]);
    const html = buildCleanerInvoiceHtml(await build({ showHours: false }));
    expect(html).toContain("Hourly — $50.00/hr");
    expect(html).not.toContain("2.00h");
  });
});
