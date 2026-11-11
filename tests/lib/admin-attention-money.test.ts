import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ invoiceCount: vi.fn(), submissionCount: vi.fn(), counter: () => vi.fn(async () => 0) }));
vi.mock("@/lib/db", () => ({
  db: {
    job: { count: m.counter() },
    cleanerPayAdjustment: { count: m.counter() },
    timeLogAdjustmentRequest: { count: m.counter() },
    laundryTask: { count: m.counter() },
    jobTask: { count: m.counter() },
    qaIssue: { count: m.counter() },
    qAReview: { count: m.counter() },
    qaAssignment: { count: m.counter() },
    issueTicket: { count: m.counter() },
    lostFoundItem: { count: m.counter() },
    quoteLead: { count: m.counter() },
    clientInvoice: { count: m.invoiceCount },
    cleanerInvoiceSubmission: { count: m.submissionCount },
  },
}));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: async () => [] }));
vi.mock("@/lib/jobs/early-checkout-requests", () => ({ listEarlyCheckoutRequests: async () => [] }));
vi.mock("@/lib/commercial/client-approvals", () => ({ listClientApprovals: async () => [] }));
vi.mock("@/lib/qa/rework-transfers", () => ({ listQaReworkTransfers: async () => [] }));

import { getAdminAttentionCounts, getMoneyAttentionCounts } from "@/lib/admin/attention-counts";

beforeEach(() => {
  m.invoiceCount.mockReset().mockResolvedValue(5);
  m.submissionCount.mockImplementation(async ({ where }: { where: { status: unknown } }) =>
    JSON.stringify(where.status) === JSON.stringify({ in: ["SUBMITTED", "PAID_CLAIMED"] }) ? 3 : 1,
  );
});

it("counts client invoices still to send (draft or approved) and cleaner invoices awaiting the office", async () => {
  expect(await getMoneyAttentionCounts()).toEqual({ clientInvoicesToSend: 5, cleanerInvoices: 3 });
  expect(m.invoiceCount).toHaveBeenCalledWith({ where: { status: { in: ["DRAFT", "APPROVED"] } } });
});

it("badges the merged entry with the sum and exposes each part for its tab", async () => {
  const counts = await getAdminAttentionCounts(new Date("2026-11-11T00:00:00Z"));
  expect(counts.finance).toBe(8);
  expect(counts.clientInvoicesToSend).toBe(5);
  expect(counts.cleanerInvoices).toBe(3);
  // The Approvals pay-claims queue (PAID_CLAIMED only) is unaffected.
  expect(counts.approvals).toBe(1);
});
