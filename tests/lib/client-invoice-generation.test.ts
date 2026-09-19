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
    // Client-paid repairs are a third line source now, so the generator queries
    // this too. Without it here the whole function dies on an undefined model
    // before it ever reaches the assertion.
    maintenanceItemAssignment: { findMany: vi.fn() },
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
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: vi.fn(async () => "INV-TEST") }));

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
    dbMock.maintenanceItemAssignment.findMany.mockResolvedValue([]);
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
    expect(where.AND[0].OR).toEqual([
      { status: { in: ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] } },
      { timeLogs: { some: {} } },
    ]);
    // Skipped cleans are never billed on any basis.
    expect(where.cleanSkipStatus).toEqual({ not: "SKIPPED" });
  });

  it("includes every eligible repair after more than 500 older repairs, preserving scope and pay checks", async () => {
    const repair = (id: string, completedAt: Date) => ({
      id, completedAt, removedAt: null, payPayer: "CLIENT", payType: "FIXED",
      payAmount: 10, payHours: null, includedInClientInvoiceId: null,
      item: { title: id, propertyId: "property_1", property: { clientId: "client_1" } },
    });
    const eligible = Array.from({ length: 501 }, (_, i) => repair(`eligible-${i}`, i === 0 ? START : END));
    const candidates = [
      ...Array.from({ length: 501 }, (_, i) => repair(`old-${i}`, new Date(START.getTime() - 1))),
      ...eligible,
      repair("future", new Date(END.getTime() + 1)),
      { ...repair("no-pay", START), payAmount: null },
      { ...repair("removed", START), removedAt: START },
      { ...repair("company", START), payPayer: "COMPANY" },
      { ...repair("billed", START), includedInClientInvoiceId: "previous" },
      { ...repair("other-property", START), item: { title: "Other", propertyId: "property_2", property: { clientId: "client_1" } } },
      { ...repair("other-client", START), item: { title: "Private", propertyId: "property_1", property: { clientId: "client_2" } } },
    ];
    // Model database filtering and any query limit before the real billing helper.
    dbMock.maintenanceItemAssignment.findMany.mockImplementation(async ({ where, take }) => {
      expect(where.completedAt).toEqual({ not: null, gte: START, lte: END });
      expect(take).toBeUndefined();
      return candidates.filter(row => row.removedAt === where.removedAt &&
        row.payPayer === where.payPayer && row.includedInClientInvoiceId === where.includedInClientInvoiceId &&
        row.item.property.clientId === where.item.property.clientId && row.item.propertyId === where.item.propertyId &&
        (!where.completedAt.gte || row.completedAt >= where.completedAt.gte) &&
        (!where.completedAt.lte || row.completedAt <= where.completedAt.lte))
        .slice(0, take);
    });
    const create = vi.fn(async ({ data }) => ({ id: "invoice", ...data }));
    const updateMany = vi.fn(async () => ({ count: 501 }));
    dbMock.$transaction.mockImplementation(async fn => fn({
      clientInvoice: { create }, maintenanceItemAssignment: { updateMany },
    }));

    await generateClientInvoice({ clientId: "client_1", propertyId: "property_1", periodStart: START, periodEnd: END });

    const lines = create.mock.calls[0][0].data.lines.create;
    expect(lines).toHaveLength(501);
    expect(lines.every((line: { lineTotal: number }) => line.lineTotal === 10)).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: eligible.map(row => row.id) } },
      data: { includedInClientInvoiceId: "invoice", includedInClientInvoiceAt: expect.any(Date) },
    });
  });
});
