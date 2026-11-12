import { afterEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ ticketCount: vi.fn(async () => 0), jobCount: vi.fn(async () => 0), counter: () => vi.fn(async () => 0) }));
vi.mock("@/lib/db", () => ({
  db: {
    cleanerPayAdjustment: { count: m.counter() },
    timeLogAdjustmentRequest: { count: m.counter() },
    jobTask: { count: m.counter() },
    laundryTask: { count: m.counter() },
    job: { count: m.jobCount },
    issueTicket: { count: m.ticketCount, findMany: vi.fn(async () => []) },
    scanTask: { count: m.counter() },
  },
}));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: async () => [] }));
vi.mock("@/lib/jobs/early-checkout-requests", () => ({ listEarlyCheckoutRequests: async () => [] }));
vi.mock("@/lib/commercial/client-approvals", () => ({ listClientApprovals: async () => [] }));
vi.mock("@/lib/qa/rework-transfers", () => ({ listQaReworkTransfers: async () => [] }));
vi.mock("@/lib/laundry/sync-draft", () => ({ getPendingLaundrySyncDraft: async () => ({}), summarizePendingLaundrySyncDraft: () => ({ itemCount: 0 }) }));
vi.mock("@/lib/phase4/disputes", () => ({ listDisputes: async () => [] }));

import { getAdminAttentionSummary, getCleanerImmediateAttention } from "@/lib/dashboard/immediate-attention";

afterEach(() => vi.useRealTimers());

// Fixed: "new cases since yesterday" and the cleaner's overdue cut-off were built
// from the server's local clock, so on a UTC server they started 10–11 hours late.
it("counts new cases from the start of yesterday in Sydney, whatever the server timezone", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T14:30:00Z")); // 01:30 on 11 Nov in Sydney
  await getAdminAttentionSummary();
  const newCases = m.ticketCount.mock.calls.map(([args]) => args as { where: { createdAt?: { gte: Date } } }).find((args) => args.where.createdAt);
  expect(newCases?.where.createdAt?.gte.toISOString()).toBe("2026-11-09T13:00:00.000Z");
});

it("treats a cleaner's job as overdue from the Sydney calendar day key", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T14:30:00Z")); // DST starts: 01:30 AEST becomes the 4th in Sydney
  await getCleanerImmediateAttention("cleaner-1");
  const overdue = m.jobCount.mock.calls.map(([args]) => args as { where: { scheduledDate?: { lt: Date } } }).find((args) => args.where.scheduledDate);
  expect(overdue?.where.scheduledDate?.lt.toISOString()).toBe("2026-10-04T00:00:00.000Z");
});
