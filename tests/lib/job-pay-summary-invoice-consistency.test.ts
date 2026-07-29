import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * REQUIREMENT 2, MADE EXECUTABLE.
 *
 * The admin job details "Cleaner pay" card reads `computeJobPaySummary`; the
 * cleaner's invoice reads `getCleanerInvoiceData`. If those two ever disagree
 * about a job, a cleaner is shown one number and paid another — the exact class
 * of bug this wave exists to kill.
 *
 * So: feed IDENTICAL fixtures through BOTH paths and assert the summary's
 * `approvedTotal` for a payee equals the invoice's line amount for that job
 * (plus, for adjustments that carry over rather than fold in, the carry-over
 * line). Cases: base only · approved addition · approved deduction · pending
 * excluded · settled shown-but-not-rebilled · QA credit attributed to the QA
 * payee, not the job's cleaner.
 */

const jobFindMany = vi.fn(async () => [] as any[]);
const adjFindMany = vi.fn(async (_args?: any) => [] as any[]);

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(async () => ({
        name: "Cleaner One",
        email: "cleaner@example.com",
        phone: null,
        address: null,
        suburb: null,
        state: null,
        postcode: null,
        abn: null,
        role: "CLEANER",
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

const CLEANER_ID = "u1";
const JOB_ID = "job1";

/** The ONE job fixture both paths see. */
const JOB_FIXTURE = {
  id: JOB_ID,
  jobType: "STANDARD_CLEAN",
  estimatedHours: 2,
  scheduledDate: new Date("2026-07-10T00:00:00Z"),
  completedAt: new Date("2026-07-10T04:00:00Z"),
  internalNotes: null,
  isRework: false,
  reworkPayAmount: null,
  property: { name: "Bondi Apt" },
  assignments: [{ userId: CLEANER_ID, payRate: 50, removedAt: null }],
};

function adj(over: Record<string, unknown> = {}) {
  return {
    id: "a1",
    jobId: JOB_ID,
    cleanerId: CLEANER_ID,
    title: "Adjustment",
    status: "APPROVED",
    approvedAmount: 40,
    requestedAmount: 40,
    includedInPayrollRunId: null,
    includedInCleanerInvoiceId: null,
    cleanerNote: null,
    adminNote: null,
    source: null,
    sourceKey: null,
    requestedAt: new Date("2026-07-11T00:00:00Z"),
    reviewedAt: new Date("2026-07-12T00:00:00Z"),
    ...over,
  } as any;
}

/** Run the INVOICE path with the given adjustment rows. */
async function invoiceFor(adjustments: any[]) {
  jobFindMany.mockResolvedValue([JOB_FIXTURE]);
  // First findMany call = settleable (APPROVED + unsettled); second = pending.
  adjFindMany.mockImplementation(async (args: any) => {
    const where = args?.where ?? {};
    if (where.status === "PENDING") {
      return adjustments.filter((row) => row.status === "PENDING");
    }
    return adjustments.filter(
      (row) =>
        row.status === "APPROVED" &&
        !row.includedInPayrollRunId &&
        !row.includedInCleanerInvoiceId &&
        row.cleanerId === CLEANER_ID
    );
  });
  const { getCleanerInvoiceData } = await import("@/lib/cleaner/invoice");
  return getCleanerInvoiceData({
    userId: CLEANER_ID,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  } as any);
}

/** Run the SUMMARY path with the given adjustment rows. */
async function summaryFor(adjustments: any[]) {
  const { computeJobPaySummary } = await import("@/lib/finance/job-pay-summary");
  return computeJobPaySummary({
    job: {
      jobType: JOB_FIXTURE.jobType as any,
      estimatedHours: JOB_FIXTURE.estimatedHours,
      isRework: JOB_FIXTURE.isRework,
      reworkPayAmount: JOB_FIXTURE.reworkPayAmount,
    },
    assignments: [
      {
        userId: CLEANER_ID,
        payRate: 50,
        removedAt: null,
        userName: "Cleaner One",
        userRole: "CLEANER",
        userHourlyRate: 30,
      },
    ],
    settings: {},
    adjustments,
    // The invoice only folds in APPROVED + unsettled rows; the summary shows
    // every row but only counts APPROVED ones — that difference is the point.
  } as any);
}

/** What the invoice actually pays this cleaner for THIS job: the job's line
 *  plus any carry-over line whose adjustment belongs to this job. */
function invoiceJobTotal(data: any): number {
  const line = data.rows.find((r: any) => r.jobId === JOB_ID);
  const carry = (data.extraLineRows ?? [])
    .filter((r: any) => r.jobId === JOB_ID)
    .reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);
  return Number((Number(line?.amount ?? 0) + carry).toFixed(2));
}

describe("job pay summary === cleaner invoice (same job, same fixtures)", { timeout: 30000 }, () => {
  beforeEach(() => {
    jobFindMany.mockClear();
    adjFindMany.mockClear();
  });

  it("base only", async () => {
    const rows: any[] = [];
    const invoice = await invoiceFor(rows);
    const [payee] = await summaryFor(rows);
    expect(invoiceJobTotal(invoice)).toBe(100);
    expect(payee.approvedTotal).toBe(invoiceJobTotal(invoice));
  });

  it("base + approved addition", async () => {
    const rows = [adj({ approvedAmount: 40, requestedAmount: 40 })];
    const invoice = await invoiceFor(rows);
    const [payee] = await summaryFor(rows);
    expect(invoiceJobTotal(invoice)).toBe(140);
    expect(payee.approvedTotal).toBe(invoiceJobTotal(invoice));
  });

  it("base + approved DEDUCTION (sign preserved on both paths)", async () => {
    const rows = [
      adj({
        approvedAmount: -30,
        requestedAmount: -30,
        source: "REWORK_DEDUCTION",
        sourceKey: `rework:${JOB_ID}`,
      }),
    ];
    const invoice = await invoiceFor(rows);
    const [payee] = await summaryFor(rows);
    expect(invoiceJobTotal(invoice)).toBe(70);
    expect(payee.approvedTotal).toBe(invoiceJobTotal(invoice));
    // …and the summary still SHOWS it, with automatic provenance.
    expect(payee.adjustments[0].origin).toBe("AUTOMATIC");
    expect(payee.adjustments[0].amount).toBe(-30);
  });

  it("PENDING is excluded from both totals but visible in the summary", async () => {
    const rows = [
      adj({ id: "ok", approvedAmount: 40, requestedAmount: 40 }),
      adj({ id: "pend", status: "PENDING", approvedAmount: null, requestedAmount: 75 }),
    ];
    const invoice = await invoiceFor(rows);
    const [payee] = await summaryFor(rows);
    expect(invoiceJobTotal(invoice)).toBe(140);
    expect(payee.approvedTotal).toBe(invoiceJobTotal(invoice));
    expect(payee.pendingDelta).toBe(75);
    expect(payee.adjustments).toHaveLength(2);
  });

  it("a SETTLED adjustment is never re-billed, yet stays visible + immutable", async () => {
    const rows = [
      adj({
        id: "settled",
        approvedAmount: 40,
        requestedAmount: 40,
        includedInCleanerInvoiceId: "inv-prev",
      }),
    ];
    const invoice = await invoiceFor(rows);
    const [payee] = await summaryFor(rows);
    // The NEXT invoice must not pay it again: the job line is base only.
    expect(invoiceJobTotal(invoice)).toBe(100);
    // The summary, however, reports the job's TRUE pay including money already
    // settled (that is what the job cost), and marks the row locked.
    expect(payee.approvedTotal).toBe(140);
    expect(payee.adjustments[0].editable).toBe(false);
    expect(payee.adjustments[0].settled?.rail).toBe("INVOICE");
    expect(invoice.includedAdjustmentIds).not.toContain("settled");
  });

  it("a QA credit on this cleaner's job is the QA's money on BOTH paths", async () => {
    const rows = [
      adj({
        id: "ded",
        cleanerId: CLEANER_ID,
        approvedAmount: -30,
        requestedAmount: -30,
        source: "RECTIFICATION_DEDUCTION",
        sourceKey: "rect:issue1:ded",
      }),
      adj({
        id: "credit",
        cleanerId: "qa1",
        cleanerName: "Inspector Ivy",
        cleanerRole: "QA_INSPECTOR",
        approvedAmount: 30,
        requestedAmount: 30,
        source: "QA_RECTIFICATION_PAY",
        sourceKey: "rect:issue1",
      }),
    ];

    // INVOICE (the cleaner's): only the cleaner's own row is selectable, so the
    // line is 100 − 30. The QA's credit never touches this invoice.
    const invoice = await invoiceFor(rows);
    expect(invoiceJobTotal(invoice)).toBe(70);
    expect(invoice.includedAdjustmentIds).toEqual(["ded"]);

    // SUMMARY: the same 70 for the cleaner, and the credit under the QA payee.
    const payees = await summaryFor(rows);
    const cleaner = payees.find((p) => p.cleanerId === CLEANER_ID)!;
    const qa = payees.find((p) => p.cleanerId === "qa1")!;
    expect(cleaner.approvedTotal).toBe(invoiceJobTotal(invoice));
    expect(cleaner.adjustments.map((a) => a.id)).toEqual(["ded"]);
    expect(qa.approvedTotal).toBe(30);
    expect(qa.assigned).toBe(false);
  });
});
