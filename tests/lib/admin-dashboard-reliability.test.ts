import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { getDashboardMetrics } from "@/lib/admin/dashboard";
const mocks = vi.hoisted(() => ({ jobs: vi.fn(), users: vi.fn(), assignments: vi.fn(), invoices: vi.fn(),
  qa: vi.fn(), feedback: vi.fn(), pings: vi.fn(), grouped: vi.fn(), stock: vi.fn(), rates: vi.fn(), prices: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  job: { findMany: mocks.jobs }, user: { count: mocks.users },
  jobAssignment: { findMany: mocks.assignments, groupBy: mocks.grouped },
  clientInvoice: { findMany: mocks.invoices }, qaAssignment: { count: mocks.qa },
  jobFeedback: { findMany: mocks.feedback }, cleanerLocationPing: { findMany: mocks.pings },
  propertyStock: { findMany: mocks.stock }, propertyClientRate: { findMany: mocks.rates }, priceBook: { findMany: mocks.prices },
} }));
beforeEach(() => {
  vi.resetAllMocks();
  for (const key of ["jobs", "assignments", "feedback", "pings", "grouped", "stock", "rates", "prices"] as const) mocks[key].mockResolvedValue([]);
  mocks.users.mockResolvedValue(0); mocks.qa.mockResolvedValue(0);
  mocks.invoices.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
describe("dashboard metrics read contracts", () => {
  it.each(["jobs", "users", "assignments", "invoices", "qa", "feedback", "pings", "stock"] as const)(
    "rejects failed %s in strict mode", async (source) => {
      mocks[source].mockRejectedValue(new Error("internal database secret"));
      await expect(getDashboardMetrics({ strict: true })).rejects.toThrow("Dashboard metrics unavailable");
    },
  );
  it.each(["rates", "prices"] as const)("does not calculate revenue after failed %s", async (source) => {
    mocks.jobs.mockResolvedValue([{ id: "j", status: "COMPLETED", jobType: "REGULAR_CLEAN", propertyId: "p", fixedPrice: null }]);
    mocks[source].mockRejectedValue(new Error("offline"));
    await expect(getDashboardMetrics({ strict: true })).rejects.toThrow("Dashboard metrics unavailable");
  });
  it("preserves explicit legacy fallback compatibility", async () => {
    mocks.jobs.mockRejectedValue(new Error("offline"));
    const result = await getDashboardMetrics();
    expect(result.today.total).toBe(0);
  });
  it("accepts real empty results in strict mode", async () => {
    const result = await getDashboardMetrics({ strict: true });
    expect(result.today).toMatchObject({ total: 0, revenueAud: 0 });
  });
  it("separates Sydney event windows from UTC schedule date keys", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T14:30:00Z"));
    await getDashboardMetrics({ strict: true });
    expect(mocks.jobs.mock.calls[0][0].where.scheduledDate.gte.toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(mocks.feedback.mock.calls[0][0].where.submittedAt.gte.toISOString()).toBe("2026-09-26T14:00:00.000Z");
  });
});

it.each(["2026-10-04T01:00:00Z", "2026-04-05T01:00:00Z"])("keeps weekly schedule keys at UTC midnight across Sydney DST: %s", async now => {
  const original = process.env.TZ;
  process.env.TZ = "Australia/Sydney";
  vi.useFakeTimers(); vi.setSystemTime(new Date(now));
  try {
    await getDashboardMetrics({ strict: true });
    const range = mocks.grouped.mock.calls[0][0].where.job.scheduledDate;
    expect(range.gte.toISOString()).toBe(now.startsWith("2026-10") ? "2026-09-28T00:00:00.000Z" : "2026-03-30T00:00:00.000Z");
    expect(range.lt.getTime() - range.gte.getTime()).toBe(7 * 86_400_000);
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});


it("excludes drafts from workload and tomorrow assignments without losing a cleaner's published job", async () => {
  const draft=serializeJobInternalNotes({isDraft:true});
  mocks.jobs.mockResolvedValue([{id:"d",status:"UNASSIGNED",internalNotes:draft},{id:"p",status:"ASSIGNED",internalNotes:null}]);
  mocks.users.mockResolvedValue(3);
  mocks.assignments.mockResolvedValue([{userId:"c1",job:{internalNotes:draft}},{userId:"c1",job:{internalNotes:null}},{userId:"c2",job:{internalNotes:draft}}]);
  const result=await getDashboardMetrics({strict:true});
  expect(result.today).toMatchObject({total:1,remaining:1});
  expect(result.tomorrow).toEqual({scheduled:1,total:3,idle:2});
});
