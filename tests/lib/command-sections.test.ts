import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  jobCount: vi.fn(), jobFind: vi.fn(), qaCount: vi.fn(), qaFirst: vi.fn(), invoiceAggregate: vi.fn(), laundryCount: vi.fn(),
  board: vi.fn(), list: vi.fn(), stats: vi.fn(), payroll: vi.fn(), metrics: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    job: { count: m.jobCount, findMany: m.jobFind },
    qaAssignment: { count: m.qaCount, findFirst: m.qaFirst },
    clientInvoice: { aggregate: m.invoiceAggregate },
    laundryTask: { count: m.laundryCount },
  },
}));
vi.mock("@/lib/ops/live-board", () => ({ loadLiveBoard: m.board }));
vi.mock("@/lib/billing/client-invoice-list", () => ({ listClientInvoices: m.list }));
vi.mock("@/lib/billing/client-invoice-stats", () => ({ getClientInvoiceStats: m.stats }));
vi.mock("@/lib/finance/payroll", () => ({ getPayrollSummary: m.payroll }));
vi.mock("@/lib/admin/dashboard", () => ({ getDashboardMetrics: m.metrics }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn(async () => ({ timezone: "Australia/Sydney" })) }));

import { loadCommandHeader, loadCommandTiles } from "@/lib/dashboard/command-sections";
import { loadCommandMoney, viewerSeesMoney } from "@/lib/dashboard/command-money";
import { loadCommandGlance } from "@/lib/dashboard/command-glance";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const ADMIN = { levels: null, readOnly: false };
const NOW = new Date("2026-11-11T02:00:00Z");
const TZ = "Australia/Sydney";

function boardWith(jobs: Array<Record<string, unknown>>) {
  return { jobs, counts: { cleanersOnShift: 9, travelling: 1, onSite: 2 }, drivers: [], continuations: [], cleaners: [] };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.jobCount.mockResolvedValue(3);
  m.qaCount.mockResolvedValue(5);
  m.qaFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 6 * 3_600_000) });
  m.list.mockResolvedValue({ total: 6 });
  m.invoiceAggregate.mockResolvedValue({ _sum: { totalAmount: 4820 } });
  m.board.mockResolvedValue(boardWith([{ state: "late", minutes: 18, sameDayCheckinTime: "14:00" }, { state: "on-site", minutes: null, sameDayCheckinTime: null }]));
  m.stats.mockResolvedValue({
    paidThisMonth: { count: 4, total: 38410, monthStart: "2026-11-01" }, outstanding: { owing: 9260, overdue: 3 }, drafts: { count: 6, total: 4820 },
    invoicedThisMonth: { total: 41200, invoiceCount: 7, invoiceTotal: 42300, creditNoteCount: 1, creditTotal: 1100, monthStart: "2026-11-01" },
  });
  m.payroll.mockResolvedValue([{ totals: { grossPay: 11940 }, jobs: [{ rateMissing: false }] }]);
  m.metrics.mockResolvedValue({ today: { revenueAud: 80, completed: 2, revenueRateMissingCount: 1 }, tomorrow: { scheduled: 4 }, recentFeedback: [] });
  m.laundryCount.mockResolvedValue(2);
  m.jobFind.mockResolvedValue([]);
});

describe("header", () => {
  it("names the Sydney date and sums real figures, including same-day arrivals before 3 pm", async () => {
    const header = await loadCommandHeader(NOW, TZ);
    expect(header).toEqual({ dateLabel: "Wednesday 11 November", summary: "2 jobs today · 9 cleaners on shift · 1 guest arrival before 3 pm" });
  });
  it("omits the summary rather than inventing one when the board fails", async () => {
    m.board.mockRejectedValue(new Error("db"));
    expect((await loadCommandHeader(NOW, TZ)).summary).toBeNull();
  });
});

describe("tiles", () => {
  it("returns four real counts with truthful badges and filtered links", async () => {
    const { tiles } = await loadCommandTiles(ADMIN, NOW, TZ);
    expect(tiles).toEqual([
      { key: "unassigned", label: "Unassigned, next 48 h", count: 3, badge: { text: "Needs you", tone: "bad" }, href: "/v2/admin/jobs?statusChip=UNASSIGNED&dateFrom=2026-11-11&dateTo=2026-11-12" },
      { key: "late", label: "Running late", count: 1, badge: { text: "18 min behind", tone: "warn" }, href: "/v2/admin/ops?view=exceptions" },
      { key: "qa", label: "Waiting for QA", count: 5, badge: { text: "Oldest 6 h", tone: "neutral" }, href: "/v2/admin/quality?tab=review" },
      { key: "invoices", label: "Invoices to send", count: 6, badge: { text: "$4,820 in drafts", tone: "gold" }, href: "/v2/admin/finance?tab=invoices&status=needs-action" },
    ]);
    expect(m.list.mock.calls[0][0].filters.status).toBe("needs-action");
  });
  it("shows one unreadable tile as unavailable, never zero, and keeps the others", async () => {
    m.qaCount.mockRejectedValue(new Error("db"));
    const { tiles } = await loadCommandTiles(ADMIN, NOW, TZ);
    expect(tiles.find((t) => t.key === "qa")).toMatchObject({ count: null, badge: { text: "Unavailable" } });
    expect(tiles.find((t) => t.key === "unassigned")?.count).toBe(3);
  });
  it("omits the invoices tile without finance and the late tile without the Live ops pack", async () => {
    const { tiles } = await loadCommandTiles({ levels: { ...allOpsLevels("manage"), finance: "off", system: "off" }, readOnly: false }, NOW, TZ);
    expect(tiles.map((t) => t.key)).toEqual(["unassigned", "qa"]);
  });
});

describe("money this month", () => {
  it("is omitted for a viewer with neither finance nor payroll", () => {
    expect(viewerSeesMoney({ levels: { ...allOpsLevels("manage"), finance: "off", payroll: "off" }, readOnly: false })).toBe(false);
    expect(viewerSeesMoney(ADMIN)).toBe(true);
  });
  it("reads the existing finance figures and states missing rates", async () => {
    const money = await loadCommandMoney(ADMIN, NOW, TZ);
    expect(money.rows.map((r) => [r.label, r.value])).toEqual([
      // "Invoiced this month" (owner decision 2026-11-11) is shown beside Paid this month and Outstanding.
      ["Invoiced this month", "$41,200"], ["Paid this month", "$38,410"], ["Outstanding", "$9,260"], ["Known charges today", "$80"], ["Cleaner pay due", "$11,940"],
    ]);
    expect(money.rows.find((r) => r.key === "invoiced")?.note).toBe("7 invoices first sent since 2026-11-01, less 1 credit note");
    expect(money.rows.find((r) => r.key === "outstanding")?.badge).toEqual({ text: "3 overdue", tone: "warn" });
    expect(money.rows.find((r) => r.key === "today")?.note).toBe("Incomplete: 1 completed job has no charge rate");
    expect(m.payroll).toHaveBeenCalledWith({ startDate: "2026-11-01", endDate: "2026-11-11" });
  });
  it("shows only pay for payroll without finance", async () => {
    const money = await loadCommandMoney({ levels: { ...allOpsLevels("manage"), finance: "off" }, readOnly: false }, NOW, TZ);
    expect(money.rows.map((r) => r.key)).toEqual(["pay"]);
    expect(m.stats).not.toHaveBeenCalled();
  });
  it("names a failed figure instead of hiding the section", async () => {
    m.payroll.mockRejectedValue(new Error("db"));
    const money = await loadCommandMoney(ADMIN, NOW, TZ);
    expect(money.unavailable).toEqual(["Cleaner pay"]);
    expect(money.rows).toHaveLength(4);
  });
});

describe("today at a glance", () => {
  it("excludes drafts from status counts, keeps every status and links each to Jobs for today", async () => {
    m.jobFind.mockImplementation(async (args: { select: Record<string, unknown> }) => args.select.id ? [] : [
      { status: "UNASSIGNED", internalNotes: serializeJobInternalNotes({ isDraft: true }) },
      { status: "WAITING_CONTINUATION_APPROVAL", internalNotes: null },
    ]);
    const glance = await loadCommandGlance(NOW, TZ);
    expect(glance.statuses?.find((s) => s.status === "UNASSIGNED")?.count).toBe(0);
    const waiting = glance.statuses?.find((s) => s.status === "WAITING_CONTINUATION_APPROVAL");
    expect(waiting).toMatchObject({ count: 1, href: "/v2/admin/jobs?statusChip=WAITING_CONTINUATION_APPROVAL&dateFrom=2026-11-11&dateTo=2026-11-11" });
    expect(glance).toMatchObject({ laundryDueToday: 2, cleanersTomorrow: 4, completedToday: 2 });
  });
  it("reports an unreadable figure as null, not zero", async () => {
    m.laundryCount.mockRejectedValue(new Error("db"));
    m.metrics.mockRejectedValue(new Error("db"));
    const glance = await loadCommandGlance(NOW, TZ);
    expect(glance).toMatchObject({ laundryDueToday: null, feedback: null, completedToday: null });
    expect(glance.statuses).not.toBeNull();
  });
  it.each([["2026-10-03T14:30:00Z", "2026-10-04"], ["2026-04-04T14:30:00Z", "2026-04-05"]])(
    "queries date-only schedules at UTC midnight of the Sydney day on DST morning %s", async (now, key) => {
      await loadCommandGlance(new Date(now), TZ);
      const statusCall = m.jobFind.mock.calls.find(([args]) => !args.select.id)?.[0];
      expect(statusCall.where.scheduledDate.gte.toISOString()).toBe(`${key}T00:00:00.000Z`);
      expect(statusCall.where.scheduledDate.lt.getTime() - statusCall.where.scheduledDate.gte.getTime()).toBe(86_400_000);
    },
  );
});
