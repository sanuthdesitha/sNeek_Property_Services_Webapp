import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Role } from "@prisma/client";
import MaintenanceTicketsPage from "@/app/v2/maintenance/tickets/page";
import { MaintenanceTicketsWorkspace } from "@/components/v2/maintenance/tickets-workspace";
import type { MaintenanceTicketSummary } from "@/lib/maintenance/ticket-stage";

const mocks = vi.hoisted(() => ({ find: vi.fn(), count: vi.fn(), requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { propertyMaintenanceItem: { findMany: mocks.find, count: mocks.count } } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
const ticket = (id: string, overrides: Partial<MaintenanceTicketSummary> = {}): MaintenanceTicketSummary => ({ id, title: `Repair ${id}`, priority: "HIGH", status: "OPEN", scheduledFor: null, enRouteAt: null, arrivedAt: null, clockInAt: null, clockOutAt: null, outcome: null, costApprovalStatus: null, property: { name: "Harbour House", suburb: "Sydney" }, ...overrides });
beforeEach(() => { vi.resetAllMocks(); mocks.requireRole.mockResolvedValue({ user: { id: "worker-1", role: Role.MAINTENANCE } }); mocks.find.mockResolvedValue([]); mocks.count.mockResolvedValue(0); });

describe("maintenance lifecycle tickets", () => {
  it("keeps failed queries distinct from empty and recovers on a fresh request", async () => {
    mocks.find.mockRejectedValueOnce(new Error("offline"));
    const view = render(await MaintenanceTicketsPage({}));
    expect(screen.getByRole("alert")).toHaveTextContent("Maintenance tickets are unavailable");
    expect(screen.queryByText("No tickets")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry tickets" })).toHaveAttribute("href", "/v2/maintenance/tickets");
    view.rerender(await MaintenanceTicketsPage({}));
    expect(screen.getByText("No tickets")).toBeVisible();
  });
  it.each([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER])("preserves existing read scope for %s with bounded pages and complete count", async (role) => {
    mocks.requireRole.mockResolvedValue({ user: { id: "worker-1", role } });
    mocks.find.mockResolvedValue(Array.from({ length: 50 }, (_, i) => ticket(String(i))));
    mocks.count.mockResolvedValue(51);
    render(await MaintenanceTicketsPage({}));
    expect(mocks.requireRole).toHaveBeenCalledWith([Role.MAINTENANCE, Role.ADMIN, Role.OPS_MANAGER]);
    const where = role === Role.MAINTENANCE ? { assignedWorker: { userId: "worker-1" } } : {};
    expect(mocks.find.mock.calls[0][0].where).toEqual(where);
    expect(mocks.find.mock.calls[0][0]).toEqual(expect.objectContaining({ take: 50, skip: 0 }));
    expect(mocks.count).toHaveBeenCalledWith({ where });
    expect(screen.getByRole("status")).toHaveTextContent("Showing 50 of 50 tickets on page 1. Total: 51.");
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute("href", "/v2/maintenance/tickets?page=2");
  });
  it("preserves the same tickets and filter through keyboard-operated board/list switches", async () => {
    render(<MaintenanceTicketsWorkspace tickets={[ticket("a"), ticket("b", { status: "ORDERED", outcome: "NEEDS_PARTS" })]} />);
    const user = userEvent.setup();
    screen.getByRole("button", { name: "Board view" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Board view" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("region", { name: "Parts ordered tickets" })).getByRole("link", { name: "Repair b" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Work order status" }), { target: { value: "ORDERED" } });
    expect(screen.queryByRole("link", { name: "Repair a" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: "List view" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("link", { name: "Repair b" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Parts ordered tickets" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search tickets" }), { target: { value: "not a house" } });
    expect(screen.getByText("No matching tickets")).toBeVisible();
    expect(screen.queryByText("No tickets")).not.toBeInTheDocument();
  });
  it("keeps unresolved visit outcomes and approval blockers visible", () => {
    render(<MaintenanceTicketsWorkspace tickets={[
      ticket("a", { costApprovalStatus: "PENDING", outcome: "NO_ACCESS" }),
      ticket("b", { costApprovalStatus: "DECLINED", outcome: "NEEDS_FOLLOWUP" }),
      ticket("c", { status: "RESOLVED", priority: "URGENT", property: null }),
      ticket("d", { status: "FUTURE_STATUS", priority: "LOW", property: { name: null, suburb: null } }),
    ]} />);
    expect(screen.getByText(/Awaiting cost approval/)).toBeVisible();
    expect(screen.getByText(/Cost declined/)).toBeVisible();
    expect(screen.getByText("No access")).toBeVisible();
    expect(screen.getByText("Needs follow-up")).toBeVisible();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Board view" }));
    expect(screen.getByRole("region", { name: "FUTURE_STATUS tickets" })).toBeVisible();
  });
  it("serializes visit dates safely at the server/client boundary", async () => {
    const date = new Date("2026-09-09T23:00:00Z");
    mocks.find.mockResolvedValue([{ ...ticket("a"), scheduledFor: date, enRouteAt: date, arrivedAt: date, clockInAt: date, clockOutAt: date }]);
    render(await MaintenanceTicketsPage({}));
    expect(screen.getByText(/Thu.*10 Sept.*9:00 am/)).toBeVisible();
    expect(screen.getByText("Visit ended; work order remains open")).toBeVisible();
  });

  it("requests the next bounded page and keeps count failures separate from the list", async () => {
    mocks.find.mockResolvedValue([ticket("last")]);
    mocks.count.mockRejectedValue(new Error("offline"));
    render(await MaintenanceTicketsPage({ searchParams: { page: "2" } }));
    expect(mocks.find.mock.calls[0][0]).toEqual(expect.objectContaining({ take: 50, skip: 50 }));
    expect(screen.getByRole("alert")).toHaveTextContent("overall ticket count is unavailable");
    expect(screen.getByRole("link", { name: "Repair last" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute("href", "/v2/maintenance/tickets?page=1");
  });
  it("keeps two maintenance users' list and count queries disjoint and never requests unassigned work", async () => {
    for (const userId of ["worker-a", "worker-b"]) {
      mocks.requireRole.mockResolvedValue({ user: { id: userId, role: Role.MAINTENANCE } });
      await MaintenanceTicketsPage({});
    }
    expect(mocks.find.mock.calls.map(([query]) => query.where)).toEqual([
      { assignedWorker: { userId: "worker-a" } }, { assignedWorker: { userId: "worker-b" } },
    ]);
    expect(mocks.count.mock.calls.map(([query]) => query.where)).toEqual([
      { assignedWorker: { userId: "worker-a" } }, { assignedWorker: { userId: "worker-b" } },
    ]);
  });
});
