import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * FIXED PAY on the cleaner invoice.
 *
 *  • D1 regression: an admin HOURS OVERRIDE on a job with a fixed payout must
 *    not revert that job to hours × rate. The override branch re-read
 *    `jobMeta.cleanerPayouts` instead of the computed `effectiveCustomPayout`,
 *    which threw away the rework rule — so an UNPAID rework (reworkPayAmount
 *    null → $0) started billing at the hourly rate the moment anyone adjusted
 *    the hours, and a fixed-payout job quietly reverted to hourly.
 *  • The row carries `paySource` so the PDF can print "Fixed" instead of a
 *    rate and an hours figure that had nothing to do with the amount.
 */

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

/**
 * The job meta blob is stored as JSON inside `internalNotes`.
 * `parseJobInternalNotes` only reads the envelope when `version === 1` —
 * anything else is treated as a plain internal note.
 */
function metaWithFixedPay(amount: number) {
  return JSON.stringify({ version: 1, cleanerPayouts: { u1: amount } });
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

describe("cleaner invoice — fixed pay", { timeout: 30000 }, () => {
  beforeEach(() => {
    jobFindMany.mockClear();
    jobFindMany.mockResolvedValue([job()]);
  });

  it("pays hours × rate when no fixed payout is set", async () => {
    const data = await build();
    expect(data.rows[0].baseAmount).toBe(100); // 2h × $50
    expect(data.rows[0].paySource).toBe("JOBTYPE_RATE");
  });

  it("pays the fixed amount and marks the row CUSTOM", async () => {
    jobFindMany.mockResolvedValue([job({ internalNotes: metaWithFixedPay(80.1) })]);
    const data = await build();
    expect(data.rows[0].baseAmount).toBe(80.1);
    expect(data.rows[0].paySource).toBe("CUSTOM");
  });

  it("keeps the fixed amount when an hours override is applied (D1)", async () => {
    jobFindMany.mockResolvedValue([job({ internalNotes: metaWithFixedPay(80.1) })]);
    const data = await build({ jobHourOverrides: { job1: 5 } });
    // Before the fix this returned 5 × $50 = $250.
    expect(data.rows[0].baseAmount).toBe(80.1);
    expect(data.rows[0].paySource).toBe("CUSTOM");
  });

  it("keeps an UNPAID rework at $0 under an hours override (D1)", async () => {
    // The worst shape of the same bug: QA marked the rework unpaid, so the
    // rework rule forces $0 — an hours override must not resurrect hourly pay.
    jobFindMany.mockResolvedValue([job({ isRework: true, reworkPayAmount: null })]);
    const data = await build({ jobHourOverrides: { job1: 3 } });
    expect(data.rows[0].baseAmount).toBe(0);
    expect(data.rows[0].paySource).toBe("CUSTOM");
  });

  it("pays a PAID rework exactly QA's amount under an hours override (D1)", async () => {
    jobFindMany.mockResolvedValue([job({ isRework: true, reworkPayAmount: 45 })]);
    const data = await build({ jobHourOverrides: { job1: 3 } });
    expect(data.rows[0].baseAmount).toBe(45);
    expect(data.rows[0].paySource).toBe("CUSTOM");
  });

  it("prints Fixed instead of a rate for a fixed row", async () => {
    const { buildCleanerInvoiceHtml } = await import("@/lib/cleaner/invoice");
    jobFindMany.mockResolvedValue([job({ internalNotes: metaWithFixedPay(80.1) })]);
    const html = buildCleanerInvoiceHtml(await build());
    expect(html).toContain(">Fixed<");
    // The hourly rate must not appear as this row's rate cell.
    expect(html).not.toContain(">$50.00<");
  });
});
