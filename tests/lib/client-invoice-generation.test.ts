import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// vi.mock factories are hoisted above module-level consts, so the mock db has
// to be created inside vi.hoisted to exist by the time the factory runs.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    client: { findUnique: vi.fn() },
    propertyClientRate: { findMany: vi.fn() },
    clientInvoiceLine: { findMany: vi.fn() },
    priceBook: { findMany: vi.fn() },
    job: { findMany: vi.fn() },
    shoppingRun: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
// The PDF renderer and S3 helper are irrelevant to job selection but their
// modules touch the environment at import time, so they are stubbed out.
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (v: string) => v }));
vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({ pricing: { gstEnabled: true } })),
}));

import { generateClientInvoice } from "@/lib/billing/client-invoices";

/**
 * These tests pin the JOB-SELECTION QUERY, not the arithmetic. The bug family
 * they guard against: a period window measured against one date while the line
 * prints another, so an invoice appears to contain jobs from outside its own
 * period (client side), or silently drops jobs (the cleaner-invoice sibling).
 */
describe("generateClientInvoice — period basis decides the job window", () => {
  const START = new Date("2026-06-30T14:00:00.000Z"); // 1 Jul 00:00 Sydney
  const END = new Date("2026-07-31T13:59:59.999Z"); // 31 Jul 23:59 Sydney

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.client.findUnique.mockResolvedValue({ id: "client_1", name: "C", email: "c@x.com" });
    dbMock.propertyClientRate.findMany.mockResolvedValue([]);
    dbMock.clientInvoiceLine.findMany.mockResolvedValue([]);
    dbMock.priceBook.findMany.mockResolvedValue([]);
    // No jobs and no shopping runs → the generator throws "No billable…",
    // which is exactly far enough: the query we assert on has been issued.
    dbMock.job.findMany.mockResolvedValue([]);
    dbMock.shoppingRun.findMany.mockResolvedValue([]);
  });

  async function runAndCaptureJobWhere(periodBasis?: "SERVICE" | "SCHEDULED") {
    await expect(
      generateClientInvoice({
        clientId: "client_1",
        periodStart: START,
        periodEnd: END,
        periodBasis,
      })
    ).rejects.toThrow(/No billable/);
    expect(dbMock.job.findMany).toHaveBeenCalledTimes(1);
    return dbMock.job.findMany.mock.calls[0][0].where;
  }

  it("SCHEDULED measures against scheduledDate alone — the date each line prints", async () => {
    const where = await runAndCaptureJobWhere("SCHEDULED");
    expect(where.scheduledDate).toEqual({ gte: START, lte: END });
    // No OR window: nothing can be pulled in by a completion date outside the
    // period, so no line can ever show a date outside the chosen window.
    expect(where.OR).toBeUndefined();
    expect(where.completedAt).toBeUndefined();
  });

  it("SERVICE keeps the historic two-branch window (completion, else scheduled)", async () => {
    const where = await runAndCaptureJobWhere("SERVICE");
    expect(where.OR).toEqual([
      { completedAt: { gte: START, lte: END } },
      { completedAt: null, scheduledDate: { gte: START, lte: END } },
    ]);
  });

  it("defaults to SERVICE when no basis is given, so auto-invoice is unchanged", async () => {
    // lib/finance/auto-invoice.ts calls the generator without a basis; its
    // monthly runs must keep billing exactly the jobs they billed before.
    const where = await runAndCaptureJobWhere(undefined);
    expect(where.OR).toBeDefined();
    expect(where.scheduledDate).toBeUndefined();
  });

  it("always scopes to the client and billable statuses regardless of basis", async () => {
    const where = await runAndCaptureJobWhere("SCHEDULED");
    expect(where.property).toEqual({ clientId: "client_1" });
    expect(where.status.in).toContain("COMPLETED");
    // Skipped cleans are never billed on any basis.
    expect(where.cleanSkipStatus).toEqual({ not: "SKIPPED" });
  });
});
