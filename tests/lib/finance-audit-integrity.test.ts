import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoices: vi.fn(), setting: vi.fn(), users: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { clientInvoice: { findMany: mocks.invoices }, appSetting: { findUnique: mocks.setting }, user: { findMany: mocks.users } } }));
import { getOutstandingReceivables, summarizeReceivables } from "@/lib/finance/receivables";
import { isInvoiceDueToday, listUsersDueForInvoicing } from "@/lib/finance/cadence";
beforeEach(() => vi.clearAllMocks());
const cadence = { userId: "client", cadence: "SEMIMONTHLY" as const, invoiceDayOfMonth: null, invoiceDayOfWeek: null, lastInvoiceGeneratedAt: null };
describe("finance audit integrity", () => {
  it("only queries issued receivables and subtracts partial payments per document", async () => {
    mocks.invoices.mockResolvedValue([{ totalAmount: 100, paidAmount: 25 }, { totalAmount: 20, paidAmount: 30 }]);
    expect(await getOutstandingReceivables()).toEqual({ outstandingCount: 2, outstandingAud: 75 });
    expect(mocks.invoices.mock.calls[0][0].where.status.in).toEqual(["SENT", "PART_PAID"]);
    expect(summarizeReceivables([])).toEqual({ outstandingCount: 0, outstandingAud: 0 });
  });
  it.each(["2026-02-16T01:00:00Z", "2026-03-01T01:00:00Z", "2028-03-01T01:00:00Z", "2026-05-01T01:00:00Z", "2026-08-01T01:00:00Z"])("prepares the Sydney morning after the cutoff %s", date => {
    expect(isInvoiceDueToday(cadence, new Date(date))).toBe(true);
  });
  it("does not run off-cutoff or twice in the same Sydney day", () => {
    expect(isInvoiceDueToday(cadence, new Date("2026-02-14T01:00:00Z"))).toBe(false);
    expect(isInvoiceDueToday({ ...cadence, lastInvoiceGeneratedAt: new Date("2026-02-15T21:00:00Z") }, new Date("2026-02-16T01:00:00Z"))).toBe(false);
  });
  it("reads opt-in JSON without requiring the database cadence enum to change", async () => {
    mocks.setting.mockResolvedValue({ value: { semimonthlyClientUserIds: ["client"] } });
    mocks.users.mockResolvedValue([{ id: "client", invoicingCadence: "CUSTOM", lastInvoiceGeneratedAt: null }]);
    expect(await listUsersDueForInvoicing(new Date("2026-02-16T01:00:00Z"))).toEqual([expect.objectContaining({ cadence: "SEMIMONTHLY" })]);
    expect(mocks.users.mock.calls[0][0].where.role).toBe("CLIENT");
  });
});
it('treats missing amounts as zero and rounds the portfolio amount once',()=>{expect(summarizeReceivables([{totalAmount:null,paidAmount:null},{totalAmount:10.005,paidAmount:null},{totalAmount:null,paidAmount:20}])).toEqual({outstandingCount:3,outstandingAud:10.01});});
