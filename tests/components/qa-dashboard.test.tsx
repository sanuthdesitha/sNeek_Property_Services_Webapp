import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QaAssignmentStatus, Role } from "@prisma/client";
import QaTodayPage from "@/app/v2/qa/page";

const mocks = vi.hoisted(() => ({
  count: vi.fn(), reworkCount: vi.fn(), roster: vi.fn(), requireRole: vi.fn(),
  queue: vi.fn(), planner: vi.fn(), settings: vi.fn(), visitOrder: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  qaAssignment: { count: mocks.count }, qaReworkTransfer: { count: mocks.reworkCount },
  user: { findMany: mocks.roster },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/components/v2/qa/qa-queue-workspace", () => ({ QaQueueWorkspace: (props: unknown) => {
  mocks.queue(props); return <div>Review queue</div>;
} }));
vi.mock("@/components/v2/qa/qa-day-planner", () => ({ QaDayPlanner: (props: unknown) => {
  mocks.planner(props); return <div>Day planner</div>;
} }));
vi.mock("@/components/v2/qa/today/qa-visit-order", () => ({ QaVisitOrder: (props: unknown) => {
  mocks.visitOrder(props); return <div>Visit order</div>;
} }));

/** Inspectors reach the full queue through the "All inspections" disclosure. */
function openAllInspections() {
  const toggle = screen.queryByRole("button", { name: "All inspections" });
  if (toggle) fireEvent.click(toggle);
}

const labels = ["To inspect", "Done", "Rework open"];
function tile(label: string) {
  return within(screen.getByText(label).parentElement!.parentElement!);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ qaPay: {} });
  mocks.requireRole.mockResolvedValue({ user: { id: "inspector-1", role: Role.QA_INSPECTOR } });
  mocks.count.mockResolvedValue(41);
  mocks.reworkCount.mockResolvedValue(7);
  mocks.roster.mockResolvedValue([{ id: "inspector-1", name: "Inspector" }]);
});
afterEach(() => vi.useRealTimers());

describe("QA dashboard reliability", () => {
  it("keeps genuine empty metrics at zero without a failure warning", async () => {
    mocks.count.mockResolvedValue(0);
    mocks.reworkCount.mockResolvedValue(0);
    render(await QaTodayPage());
    for (const label of labels) expect(tile(label).getByText("0")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Retry" })).not.toBeInTheDocument();
  });

  it.each([0, 1, 2])("isolates failed metric %i and recovers on a fresh page request", async (failed) => {
    if (failed === 2) mocks.reworkCount.mockRejectedValueOnce(new Error("offline"));
    else for (let index = 0; index < 2; index++) {
      if (index === failed) mocks.count.mockRejectedValueOnce(new Error("offline"));
      else mocks.count.mockResolvedValueOnce(0);
    }
    const view = render(await QaTodayPage());
    expect(tile(labels[failed]).getByText("Unavailable")).toBeVisible();
    expect(screen.getAllByText("Unavailable")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Some QA figures could not be loaded.");
    expect(screen.getByRole("link", { name: "Retry" })).toHaveAttribute("href", "/v2/qa");
    for (let index = 0; index < 3; index++) {
      if (index !== failed) expect(tile(labels[index]).getByText(index === 2 ? "7" : failed === 2 ? "41" : "0")).toBeVisible();
    }
    view.rerender(await QaTodayPage());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
  });

  it("shows all failed metrics as unavailable while keeping the review workspace", async () => {
    mocks.count.mockRejectedValue(new Error("offline"));
    mocks.reworkCount.mockRejectedValue(new Error("offline"));
    render(await QaTodayPage());
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    openAllInspections();
    expect(screen.getByText("Review queue")).toBeVisible();
    expect(screen.getByText("Visit order")).toBeVisible();
  });

  it.each([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER])("preserves full totals and ownership for %s", async (role) => {
    mocks.requireRole.mockResolvedValue({ user: { id: "inspector-1", role } });
    render(await QaTodayPage());
    openAllInspections();
    expect(mocks.requireRole).toHaveBeenCalledWith([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
    const canAssign = role !== Role.QA_INSPECTOR;
    const owner = canAssign ? {} : { OR: [{ assignedToId: "inspector-1" }, { pickedUpById: "inspector-1" }] };
    expect(mocks.count.mock.calls.map(([args]) => args)).toEqual([
      { where: { ...owner, status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] } } },
      { where: { ...owner, status: QaAssignmentStatus.COMPLETED, completedAt: { gte: expect.any(Date), lt: expect.any(Date) } } },
    ]);
    for (const label of labels.slice(0, 2)) expect(tile(label).getByText("41")).toBeVisible();
    // Rework open: the PENDING definition shared with the Rework badge and Approvals.
    expect(mocks.reworkCount).toHaveBeenCalledWith({ where: { status: "PENDING" } });
    expect(tile("Rework open").getByText("team-wide")).toBeVisible();
    expect(mocks.visitOrder).toHaveBeenCalledWith(expect.objectContaining({ viewerId: "inspector-1", canReorder: canAssign }));
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ canAssign, inspectors: canAssign ? [{ id: "inspector-1", name: "Inspector" }] : [] }));
    expect(mocks.roster).toHaveBeenCalledTimes(canAssign ? 1 : 0);
    expect(mocks.planner).toHaveBeenCalledTimes(canAssign ? 1 : 0);
  });

  it.each([
    ["2026-10-03T15:00:00Z", "2026-10-03T14:00:00.000Z", "2026-10-04T13:00:00.000Z", 23],
    ["2026-04-04T14:00:00Z", "2026-04-04T13:00:00.000Z", "2026-04-05T14:00:00.000Z", 25],
  ])("uses Sydney's day at %s for the done-today metric", async (now, start, end, hours) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    await QaTodayPage();
    const completed = mocks.count.mock.calls[1][0].where.completedAt;
    for (const range of [completed]) {
      expect(range).toEqual({ gte: new Date(start), lt: new Date(end) });
      expect((range.lt.getTime() - range.gte.getTime()) / 3_600_000).toBe(hours);
    }
  });
});
