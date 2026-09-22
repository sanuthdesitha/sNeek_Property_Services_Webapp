// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ invoices: vi.fn(), invoiceAggregate: vi.fn(), agencyAggregate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
 clientInvoice: { findMany: m.invoices, aggregate: m.invoiceAggregate },
 clientInvoiceLine: { aggregate: m.agencyAggregate },
 job: { findMany: async () => [] }, quoteLead: { count: async () => 0 },
 client: { findMany: async () => [] }, qAReview: { findMany: async () => [] },
} }));
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
const now = new Date("2026-09-22T12:00:00Z");
const job = { jobType: "REGULAR_CLEAN", assignments: [{ userId: "cleaner", user: { name: "Cleaner", email: null } }] };
function invoice(date: string, totalAmount: number, lines: any[], paidAt: Date | null = new Date(date)) {
 return { id: date, clientId: "client", paidAt, createdAt: new Date(date), totalAmount, lines };
}
beforeEach(() => { vi.resetAllMocks(); m.invoices.mockResolvedValue([]); m.invoiceAggregate.mockResolvedValue({ _avg: { totalAmount: null }, _count: { _all: 0 } }); m.agencyAggregate.mockResolvedValue({ _sum: { lineTotal: null } }); });
it("removes agency amounts from all revenue views while preserving ordinary charges and labour", async () => {
 m.invoices.mockResolvedValue([
  invoice("2026-09-10", 243, [{ category: "SHOPPING_DISBURSEMENT", lineTotal: 100, job }, { category: "SERVICE", lineTotal: 100, job }, { category: "SHOPPING_TIME", lineTotal: 20, job: null }, { category: "SHOPPING_REIMBURSEMENT", lineTotal: 10, job: null }]),
  invoice("2026-08-10", 55, [{ category: "SERVICE", lineTotal: 50, job }], null),
 ]);
 // Aggregate deliberately includes an older invoice outside the trend window.
 m.invoiceAggregate.mockResolvedValue({ _avg: { totalAmount: 166 }, _count: { _all: 3 } });
 m.agencyAggregate.mockResolvedValue({ _sum: { lineTotal: 200 } });
 const result = await getFinanceDashboardData(now);
 expect(result.metrics.mtdRevenue).toBe(143);
 expect(result.metrics.ytdRevenue).toBe(198);
 expect(result.metrics.avgJobValue).toBeCloseTo(166 - 200 / 3);
 expect(result.revenueByMonth).toEqual([{ label: "2026-09", revenue: 143 }, { label: "2026-08", revenue: 55 }]);
 expect(result.revenueByServiceType).toEqual([{ label: "REGULAR CLEAN", revenue: 150 }, { label: "SHOPPING_TIME", revenue: 20 }, { label: "SHOPPING_REIMBURSEMENT", revenue: 10 }]);
 expect(result.revenueByCleaner).toEqual([{ label: "Cleaner", revenue: 150 }]);
 const population = m.invoiceAggregate.mock.calls[0][0].where;
 expect(m.agencyAggregate.mock.calls[0][0].where).toEqual({ category: "SHOPPING_DISBURSEMENT", invoice: population });
 expect(population.OR).toEqual([{ paidAt: { lte: now } }, { paidAt: null, createdAt: { lte: now } }]);
});
it("agency-only and empty invoices do not create income or a divide-by-zero average", async () => {
 m.invoices.mockResolvedValue([invoice("2026-09-10", 100, [{ category: "SHOPPING_DISBURSEMENT", lineTotal: 100, job }])]);
 m.invoiceAggregate.mockResolvedValue({ _avg: { totalAmount: 100 }, _count: { _all: 1 } });
 m.agencyAggregate.mockResolvedValue({ _sum: { lineTotal: 100 } });
 const result = await getFinanceDashboardData(now);
 expect(result.metrics).toMatchObject({ mtdRevenue: 0, ytdRevenue: 0, avgJobValue: 0 });
 expect(result.revenueByCleaner).toEqual([]); expect(result.revenueByServiceType).toEqual([]);
 m.invoices.mockResolvedValue([]); m.invoiceAggregate.mockResolvedValue({ _avg: { totalAmount: null }, _count: { _all: 0 } }); m.agencyAggregate.mockResolvedValue({ _sum: { lineTotal: null } });
 expect((await getFinanceDashboardData(now)).metrics.avgJobValue).toBe(0);
});
