import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminCommandPage from "@/app/v2/admin/page";

const mocks = vi.hoisted(() => ({
  jobs: vi.fn(), statuses: vi.fn(), pings: vi.fn(), timers: vi.fn(), laundry: vi.fn(), metrics: vi.fn(), attention: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  job: { findMany: mocks.jobs, groupBy: mocks.statuses },
  cleanerLocationPing: { findMany: mocks.pings }, timeLog: { findMany: mocks.timers },
  laundryTask: { count: mocks.laundry },
} }));
vi.mock("@/lib/admin/dashboard", () => ({ getDashboardMetrics: mocks.metrics }));
vi.mock("@/lib/dashboard/immediate-attention", () => ({ getAdminAttentionSummary: mocks.attention }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.jobs.mockResolvedValue([]);
  mocks.statuses.mockResolvedValue([]);
  mocks.pings.mockResolvedValue([]);
  mocks.timers.mockResolvedValue([]);
  mocks.laundry.mockResolvedValue(0);
  mocks.attention.mockResolvedValue({ attentionCount: 0 });
  mocks.metrics.mockResolvedValue({ today: { total: 0, revenueAud: 0, completed: 0 }, qaPending: 0,
    invoices: { outstandingCount: 0, outstandingAud: 0 }, tomorrow: { scheduled: 0, idle: 0, total: 0 }, recentFeedback: [] });
});
afterEach(() => vi.useRealTimers());

describe("admin command trustworthy results", () => {
  it.each(["jobs", "statuses", "pings", "timers", "laundry", "metrics", "attention"] as const)(
    "does not show false empty work after %s fails", async (source) => {
      mocks[source].mockRejectedValue(new Error("private database diagnostic"));
      render(await AdminCommandPage());
      expect(screen.getByRole("alert")).toHaveTextContent("Current workload and totals are unavailable");
      expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/v2/admin");
      expect(screen.queryByText("No jobs scheduled today.")).toBeNull();
      expect(screen.queryByText(/private database diagnostic/)).toBeNull();
    },
  );
  it("uses complete grouped counts even with an empty dispatch preview", async () => {
    mocks.statuses.mockResolvedValue([{ status: "UNASSIGNED", _count: { _all: 41 } }]);
    render(await AdminCommandPage());
    expect(screen.getByText("41 jobs today have no cleaner")).toBeVisible();
    expect(mocks.metrics).toHaveBeenCalledWith({ strict: true });
  });
  it("renders a genuine empty dashboard", async () => {
    render(await AdminCommandPage());
    expect(screen.getByText("No jobs scheduled today.")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it.each(["2026-10-03T14:30:00Z", "2026-04-04T14:30:00Z"])(
    "queries date-only schedules at UTC midnight on Sydney DST day %s", async (now) => {
      vi.useFakeTimers(); vi.setSystemTime(new Date(now));
      await AdminCommandPage();
      const range = mocks.statuses.mock.calls[0][0].where.scheduledDate;
      const key = now.startsWith("2026-10") ? "2026-10-04" : "2026-04-05";
      expect(range.gte.toISOString()).toBe(`${key}T00:00:00.000Z`);
      expect(range.lt.getTime() - range.gte.getTime()).toBe(86_400_000);
    },
  );
});

it.each([
  ["pendingTimeAdjustments", "Clock adjustments"], ["pendingClientTaskRequests", "Client tasks"],
  ["pendingTimingRequests", "Timing requests"], ["pendingQaReworkTransfers", "QA rework"],
  ["pendingSkipRequests", "Skip requests"], ["pendingQaOutcomes", "QA outcomes"],
  ["pendingLaundryRescheduleDraft", "Laundry reschedules"],
])("surfaces %s as actionable work", async (field, label) => {
  mocks.attention.mockResolvedValue({ attentionCount: 2, [field]: 2 });
  render(await AdminCommandPage());
  expect(screen.getByRole("link", { name: new RegExp(label) })).toHaveAttribute("href", field === "pendingLaundryRescheduleDraft" ? "/v2/admin/laundry" : "/v2/admin/approvals");
  expect(screen.queryByText("Nothing needs you")).toBeNull();
});
it("does not claim all clear when pending counts lack category details", async () => {
  mocks.attention.mockResolvedValue({ attentionCount: 3 });
  render(await AdminCommandPage());
  expect(screen.getByRole("link", { name: "Review approval queues" })).toHaveAttribute("href", "/v2/admin/approvals");
  expect(screen.queryByText("Nothing needs you")).toBeNull();
});
it("makes missing-rate exclusions explicit in both revenue summaries", async () => {
  mocks.metrics.mockResolvedValue({ today: { total: 2, completed: 2, revenueAud: 80, revenueRateMissingCount: 1 },
    qaPending: 0, invoices: { outstandingCount: 0, outstandingAud: 0 }, tomorrow: {}, recentFeedback: [] });
  render(await AdminCommandPage());
  expect(screen.getAllByText("Known charges today")).toHaveLength(2);
  expect(screen.getByText(/Incomplete total: 1 completed job has no charge rate/)).toBeVisible();
  expect(screen.queryByText("Revenue today")).toBeNull();
});
it("surfaces non-today unassigned work and non-overdue cases", async () => {
  mocks.attention.mockResolvedValue({ attentionCount: 8, unassignedJobs: 5, openCases: 3, overdueCases: 1 });
  mocks.statuses.mockResolvedValue([{ status: "UNASSIGNED", _count: { _all: 2 } }]);
  render(await AdminCommandPage());
  expect(screen.getByText("3 unassigned jobs outside today's schedule")).toBeVisible();
  expect(screen.getByText("2 open cases without an overdue deadline to review")).toBeVisible();
});
