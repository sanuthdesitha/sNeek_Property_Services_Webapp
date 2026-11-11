// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ urgent: vi.fn(async () => 2), lostFound: vi.fn(async () => 1), counter: () => vi.fn(async () => 0), requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    job: { count: m.counter() }, cleanerPayAdjustment: { count: m.counter() }, timeLogAdjustmentRequest: { count: m.counter() },
    laundryTask: { count: m.counter() }, jobTask: { count: m.counter() }, qaIssue: { count: m.counter() }, qAReview: { count: m.counter() },
    qaAssignment: { count: m.counter() }, issueTicket: { count: m.counter() }, lostFoundItem: { count: m.lostFound }, quoteLead: { count: m.counter() },
    clientInvoice: { count: m.counter() }, cleanerInvoiceSubmission: { count: m.counter() }, urgentStockNeed: { count: m.urgent },
  },
}));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: async () => [] }));
vi.mock("@/lib/jobs/early-checkout-requests", () => ({ listEarlyCheckoutRequests: async () => [] }));
vi.mock("@/lib/commercial/client-approvals", () => ({ listClientApprovals: async () => [] }));
vi.mock("@/lib/qa/rework-transfers", () => ({ listQaReworkTransfers: async () => [] }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));

import { getAdminAttentionCounts } from "@/lib/admin/attention-counts";
import { GET } from "@/app/api/admin/nav-attention/route";

beforeEach(() => vi.clearAllMocks());

it("badges Inventory with needs awaiting acknowledgement (REPORTED) for administrators only", async () => {
  const counts = await getAdminAttentionCounts(new Date("2026-11-11T00:00:00Z"), { includeUrgentStock: true });
  expect(counts.urgentStock).toBe(2);
  expect(m.urgent).toHaveBeenCalledWith({ where: { stage: "REPORTED" } });
  expect(counts.lostFound).toBe(1);
  expect(m.lostFound).toHaveBeenCalledWith({ where: { status: "REPORTED" } });
  expect((await getAdminAttentionCounts(new Date("2026-11-11T00:00:00Z"))).urgentStock).toBeNull();
});

it("the nav route counts urgent needs only for an administrator", async () => {
  m.requireRole.mockResolvedValueOnce({ user: { id: "o", role: "OPS_MANAGER" } });
  expect((await (await GET()).json()).counts.urgentStock).toBeNull();
  m.requireRole.mockResolvedValueOnce({ user: { id: "a", role: "ADMIN" } });
  expect((await (await GET()).json()).counts.urgentStock).toBe(2);
});
