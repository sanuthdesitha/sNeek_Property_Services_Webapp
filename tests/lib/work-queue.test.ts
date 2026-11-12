import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  summary: vi.fn(),
  jobCount: vi.fn(),
  jobFind: vi.fn(),
  continuations: vi.fn(),
  shopping: vi.fn(),
  receivables: vi.fn(),
  ok: (value: unknown) => vi.fn(async () => value),
}));

vi.mock("@/lib/db", () => ({
  db: {
    job: { count: m.jobCount, findMany: m.jobFind },
    issueTicket: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ id: "case1", title: "Scratched bench", severity: "HIGH", caseType: "DAMAGE", createdAt: new Date("2026-11-01T00:00:00Z"), jobId: "job9", property: { name: "Harbour View" } }]),
    },
    laundryTask: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ id: "l1", status: "FLAGGED", pickupDate: new Date("2026-11-11T00:00:00Z"), dropoffDate: new Date("2026-11-12T00:00:00Z"), property: { name: "Glebe" } }]),
    },
    quoteLead: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ id: "lead1", name: "Priya", suburb: "Bondi", serviceType: "DEEP_CLEAN", createdAt: new Date("2026-11-11T01:00:00Z"), quotes: [{ id: "q1" }] }]),
    },
    staffDocument: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ id: "d1", title: "Police check", category: "COMPLIANCE", expiresAt: new Date("2026-11-20T00:00:00Z"), user: { id: "u7", name: "Marco R.", email: "m@x" } }]),
    },
    lostFoundItem: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [{ id: "lf1", itemName: "watch", guestName: "Priya Shah", guestContact: "priya@example.com", createdAt: new Date("2026-11-11T00:00:00Z"), propertyId: "p1" }]),
    },
    property: { findMany: vi.fn(async () => [{ id: "p1", name: "The Bondi Studio" }]) },
    user: { findMany: vi.fn(async () => [{ id: "u1", name: "Jane C." }]) },
    qaAssignment: { count: vi.fn(async () => 5) },
    propertyStock: { count: vi.fn(async () => 2), fields: { reorderThreshold: "reorderThreshold" } },
    clientInvoice: { count: vi.fn(async () => 6) },
  },
}));
vi.mock("@/lib/dashboard/immediate-attention", () => ({ getAdminAttentionSummary: m.summary }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ listContinuationRequests: m.continuations }));
vi.mock("@/lib/inventory/shopping-runs", () => ({ listShoppingRunsForAdmin: m.shopping }));
vi.mock("@/lib/finance/receivables", () => ({ getOutstandingReceivables: m.receivables }));

import { buildWorkQueue } from "@/lib/dashboard/work-queue";
import type { WorkQueueKind } from "@/lib/dashboard/work-queue-types";

const ADMIN = { levels: null, readOnly: false };
const NOW = new Date("2026-11-11T02:00:00Z"); // 13:00 Sydney, 11 Nov

const SUMMARY = {
  pendingPayRequests: 2, pendingTimeAdjustments: 3, pendingClientTaskRequests: 1, flaggedLaundry: 4, pendingLaundryRescheduleDraft: 1,
  unassignedJobs: 9, highCases: 2, newCases: 1, pendingContinuations: 1, pendingClientApprovals: 2, pendingQaOutcomes: 1,
  pendingTimingRequests: 1, pendingQaReworkTransfers: 1, pendingSkipRequests: 1, openCases: 5, overdueCases: 2, attentionCount: 30,
};

beforeEach(() => {
  m.summary.mockReset().mockResolvedValue(SUMMARY);
  m.jobCount.mockReset().mockResolvedValue(3);
  m.jobFind.mockReset().mockResolvedValue([
    { id: "job1", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: "10:00", jobType: "AIRBNB_TURNOVER", sameDayCheckin: true, sameDayCheckinTime: "15:00", property: { name: "The Bondi Studio", suburb: "Bondi" } },
  ]);
  m.continuations.mockReset().mockResolvedValue([
    { id: "c1", jobId: "job2", requestedByUserId: "u1", reason: "oven not finished", preferredDate: "2026-11-12", estimatedRemainingHours: 2, status: "PENDING", requestedAt: "2026-11-11T01:00:00Z" },
  ]);
  m.shopping.mockReset().mockResolvedValue([
    { id: "r1", name: "Run", ownerName: "Jane C.", cleanerReimbursementStatus: "PENDING_APPROVAL", totals: { reimbursableCleanerAmount: 20 }, payment: { receipts: [{}] } },
    { id: "r2", name: "Done", cleanerReimbursementStatus: "READY", totals: { reimbursableCleanerAmount: 5 }, payment: {} },
  ]);
  m.receivables.mockReset().mockResolvedValue({ outstandingCount: 3, outstandingAud: 9260 });
});

const LEGACY_KINDS: WorkQueueKind[] = [
  // old Command "Needs attention" + immediate attention + Live ops planning lists
  "unassigned-soon", "unassigned-later", "case-open", "case-overdue", "case-high", "case-new", "clock-adjustment", "client-task",
  "timing-request", "qa-rework", "skip-request", "qa-outcome", "laundry-draft", "continuation", "client-approval", "pay-request",
  "invoices-outstanding", "qa-pending", "laundry-flagged", "low-stock", "case-stale", "lead-new", "laundry-exception", "document-expiring",
];

describe("buildWorkQueue", () => {
  it("still produces every legacy attention kind, plus the new inline decisions", async () => {
    const queue = await buildWorkQueue(ADMIN, { now: NOW });
    const kinds = new Set(queue.items.map((row) => row.kind));
    for (const kind of LEGACY_KINDS) expect(kinds, kind).toContain(kind);
    expect(kinds).toContain("shopping-reimbursement");
    expect(kinds).toContain("lost-item");
    expect(kinds).toContain("invoices-draft");
    expect(queue.unavailable).toEqual([]);
  });

  it("links each row to its page already filtered, and to the specific record where one exists", async () => {
    const queue = await buildWorkQueue(ADMIN, { now: NOW });
    const href = (kind: WorkQueueKind) => queue.items.find((row) => row.kind === kind)?.href;
    expect(href("unassigned-later")).toBe("/v2/admin/jobs?statusChip=UNASSIGNED");
    expect(href("unassigned-soon")).toBe("/v2/admin/jobs/job1");
    expect(href("qa-pending")).toBe("/v2/admin/quality?tab=review");
    expect(href("invoices-draft")).toBe("/v2/admin/finance?tab=invoices&status=DRAFT");
    expect(href("lead-new")).toBe("/v2/admin/quotes/q1");
    expect(href("document-expiring")).toBe("/v2/admin/accounts/users/u7");
    expect(href("pay-request")).toBe("/v2/admin/finance?tab=adjustments");
    expect(href("case-stale")).toBe("/v2/admin/cases?open=case1");
    expect(href("case-overdue")).toBe("/v2/admin/cases?queue=open");
    const lost = queue.items.find((row) => row.kind === "lost-item");
    expect(lost?.actions.find((a) => a.label === "Contact guest")).toMatchObject({ kind: "link", href: "mailto:priya@example.com" });
    // Wave E: the row opens the item itself in Lost and found.
    expect(lost?.href).toMatch(/^\/v2\/admin\/lost-found\?stage=new&open=/);
  });

  it("offers Send reminder for an expiring document beside Open account", async () => {
    const queue = await buildWorkQueue(ADMIN, { now: NOW });
    const doc = queue.items.find((row) => row.kind === "document-expiring");
    expect(doc?.actions.map((a) => a.label)).toEqual(["Send reminder", "Open account"]);
    expect(doc?.actions[0]).toMatchObject({ kind: "document-reminder", endpoint: "/api/admin/workforce", primary: true });
  });

  it("offers the existing endpoints for inline decisions", async () => {
    const queue = await buildWorkQueue(ADMIN, { now: NOW });
    const continuation = queue.items.find((row) => row.kind === "continuation");
    expect(continuation?.actions).toEqual([
      expect.objectContaining({ kind: "request", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "REJECT" } }),
      expect.objectContaining({ kind: "request", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "APPROVE" } }),
    ]);
    const shopping = queue.items.filter((row) => row.kind === "shopping-reimbursement");
    expect(shopping).toHaveLength(1);
    expect(shopping[0].actions[1]).toMatchObject({ endpoint: "/api/admin/inventory/shopping-runs/r1", body: { cleanerReimbursementStatus: "READY" } });
    expect(queue.items.find((row) => row.kind === "unassigned-soon")?.actions.map((a) => a.kind)).toEqual(["assign", "assign"]);
  });

  it("uses real totals: later unassigned is the summary total less the next 48 hours, flagged laundry is not counted twice", async () => {
    const queue = await buildWorkQueue(ADMIN, { now: NOW });
    expect(queue.items.find((row) => row.kind === "unassigned-later")?.count).toBe(6);
    expect(queue.items.filter((row) => row.kind === "unassigned-soon").reduce((s, r) => s + r.count, 0)).toBe(3);
  });

  it("isolates a failing source: its rows are missing and named, the rest still come back", async () => {
    m.summary.mockRejectedValue(new Error("private database detail"));
    const queue = await buildWorkQueue(ADMIN, { now: NOW });
    expect(queue.unavailable).toEqual(["Approval and case counts"]);
    expect(queue.items.some((row) => row.kind === "continuation")).toBe(true);
    expect(queue.items.some((row) => row.kind === "clock-adjustment")).toBe(false);
    expect(JSON.stringify(queue)).not.toContain("private database detail");
  });

  it("omits money rows for a manager without finance", async () => {
    const { allOpsLevels } = await import("@/lib/rbac/ops-catalog");
    const queue = await buildWorkQueue({ levels: { ...allOpsLevels("manage"), finance: "off" }, readOnly: false }, { now: NOW });
    expect(queue.items.filter((row) => row.category === "money")).toEqual([]);
    expect(queue.chips.map((chip) => chip.key)).not.toContain("money");
  });

  it.each([
    ["UTC late evening is already tomorrow in Sydney", "2026-11-10T14:30:00Z", "2026-11-11"],
    ["the morning daylight saving starts", "2026-10-03T14:30:00Z", "2026-10-04"],
    ["the morning daylight saving ends", "2026-04-04T14:30:00Z", "2026-04-05"],
  ])("queries unassigned jobs from Sydney's calendar day: %s", async (_label, now, key) => {
    await buildWorkQueue(ADMIN, { now: new Date(now) });
    const range = m.jobCount.mock.calls[0][0].where.scheduledDate;
    expect(range.gte.toISOString()).toBe(`${key}T00:00:00.000Z`);
    expect(range.lt.getTime() - range.gte.getTime()).toBe(2 * 86_400_000);
  });
});
