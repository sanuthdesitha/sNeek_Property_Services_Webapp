import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LaundryStatus, Role } from "@prisma/client";
import LaundryTodayPage from "@/app/v2/laundry/page";

const mocks = vi.hoisted(() => ({ tasks: vi.fn(), routes: vi.fn(), property: vi.fn(), requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  laundryTask: { findMany: mocks.tasks }, laundryRoute: { findMany: mocks.routes },
  property: { findUnique: mocks.property },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/components/v2/laundry/plan-brief", () => ({ PlanBrief: () => <div>Plan brief</div> }));
vi.mock("@/components/v2/laundry/route-map", () => ({ LaundryRouteMap: () => <div>Route map</div> }));

const labels = ["In queue", "In transit", "Delivered", "In pipeline"];
const stop = { taskId: "task-1", propertyId: "property-1", kind: "PICKUP", order: 0 };
const activeRoute = { status: "ACTIVE", updatedAt: new Date("2026-09-08"), stops: [stop] };
function tile(label: string) { return within(screen.getByText(label, { selector: "p" }).parentElement!.parentElement!); }
function task(id: string, status: LaundryStatus, droppedAt: Date | null = null) {
  return { id, status, droppedAt, bagWeightKg: 3, property: { name: `House ${id}`, suburb: "Sydney" } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "driver-1", role: Role.LAUNDRY } });
  mocks.tasks.mockResolvedValue([]);
  mocks.routes.mockResolvedValue([]);
  mocks.property.mockResolvedValue({ name: "Harbour House" });
});
afterEach(() => vi.useRealTimers());

describe("laundry dashboard reliability", () => {
  it("preserves genuine empty queries and zero totals", async () => {
    render(await LaundryTodayPage());
    labels.forEach((label) => expect(tile(label).getByText("0")).toBeVisible());
    expect(screen.getByText("No laundry scheduled")).toBeVisible();
    expect(screen.getByRole("link", { name: "Build route" })).toHaveAttribute("href", "/v2/laundry/route");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows failed tasks as unavailable while retaining an active route, then recovers", async () => {
    mocks.tasks.mockRejectedValueOnce(new Error("offline"));
    mocks.routes.mockResolvedValue([activeRoute]);
    const view = render(await LaundryTodayPage());
    labels.forEach((label) => expect(tile(label).getByText("Unavailable")).toBeVisible());
    expect(screen.queryByText("No laundry scheduled")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue route" })).toBeVisible();
    expect(screen.getByText("Next: Harbour House pickup")).toBeVisible();
    expect(screen.getByRole("link", { name: "Retry laundry" })).toHaveAttribute("href", "/v2/laundry");
    view.rerender(await LaundryTodayPage());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No laundry scheduled")).toBeVisible();
  });

  it("isolates route failures from present laundry totals and rows", async () => {
    mocks.routes.mockRejectedValueOnce(new Error("offline"));
    mocks.tasks.mockResolvedValue([task("1", LaundryStatus.PENDING), task("2", LaundryStatus.PICKED_UP)]);
    const view = render(await LaundryTodayPage());
    expect(screen.getByRole("alert")).toHaveTextContent("Today's route is unavailable.");
    expect(screen.queryByRole("link", { name: "Build route" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retry route" })).toHaveAttribute("href", "/v2/laundry");
    ["1", "1", "0", "2"].forEach((value, i) => expect(tile(labels[i]).getByText(value)).toBeVisible());
    expect(screen.getByText("House 1, Sydney")).toBeVisible();
    view.rerender(await LaundryTodayPage());
    expect(screen.getByRole("link", { name: "Build route" })).toBeVisible();
  });

  it("keeps independent panels when both primary queries fail", async () => {
    mocks.tasks.mockRejectedValue(new Error("offline"));
    mocks.routes.mockRejectedValue(new Error("offline"));
    render(await LaundryTodayPage());
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByText("Plan brief")).toBeVisible();
    expect(screen.getByText("Route map")).toBeVisible();
    expect(screen.queryByText("No laundry scheduled")).not.toBeInTheDocument();
  });

  it("retains route progress on property failure and distinguishes a missing property", async () => {
    mocks.routes.mockResolvedValue([activeRoute]);
    mocks.property.mockRejectedValueOnce(new Error("offline"));
    const view = render(await LaundryTodayPage());
    expect(screen.getByText(/Route in progress/)).toHaveTextContent("stop 1 of 1");
    expect(screen.getByText("Next: Property unavailable pickup")).toBeVisible();
    expect(screen.getByRole("link", { name: "Retry property details" })).toHaveAttribute("href", "/v2/laundry");
    expect(screen.getByRole("link", { name: "Continue route" })).toBeVisible();
    expect(mocks.property).toHaveBeenCalledWith({ where: { id: "property-1" }, select: { name: true } });
    mocks.property.mockResolvedValueOnce(null);
    view.rerender(await LaundryTodayPage());
    expect(screen.getByText("Next: Unknown property pickup")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prefers active routes over drafts and preserves completed progress", async () => {
    mocks.routes.mockResolvedValue([
      { status: "DRAFT", updatedAt: new Date("2026-09-09"), stops: [] },
      { ...activeRoute, stops: [{ ...stop, completedAt: "2026-09-09T01:00:00Z" }] },
    ]);
    render(await LaundryTodayPage());
    expect(screen.getByRole("link", { name: "Continue route" })).toBeVisible();
    expect(screen.getByText(/All stops complete/)).toBeVisible();
    expect(mocks.property).not.toHaveBeenCalled();
  });

  it("offers an existing draft for resumption", async () => {
    mocks.routes.mockResolvedValue([{ ...activeRoute, status: "DRAFT" }]);
    render(await LaundryTodayPage());
    expect(screen.getByText("Your route draft is waiting")).toBeVisible();
    expect(screen.getByRole("link", { name: "Resume draft" })).toHaveAttribute("href", "/v2/laundry/route");
  });

  it("renders exception statuses and missing property or weight without hiding a load", async () => {
    mocks.tasks.mockResolvedValue([
      { ...task("flag", LaundryStatus.FLAGGED), property: null, bagWeightKg: null },
      { ...task("skip", LaundryStatus.SKIPPED_PICKUP), property: { name: "No suburb", suburb: null } },
      task("future", "FUTURE_STATUS" as LaundryStatus),
    ]);
    render(await LaundryTodayPage());
    expect(screen.getByText("Flagged")).toBeVisible();
    expect(screen.getByText("Skipped")).toBeVisible();
    expect(screen.getByText("FUTURE_STATUS")).toBeVisible();
    expect(screen.getByText("Weight t.b.c.")).toBeVisible();
    expect(screen.getByText("Property")).toBeVisible();
    expect(screen.getByText("No suburb")).toBeVisible();
  });

  it("handles multiple route drafts and a drop-off next stop", async () => {
    mocks.routes.mockResolvedValueOnce([
      { ...activeRoute, status: "DRAFT", updatedAt: new Date("2026-09-08") },
      { ...activeRoute, status: "DRAFT", updatedAt: new Date("2026-09-09") },
    ]);
    const view = render(await LaundryTodayPage());
    expect(screen.getByRole("link", { name: "Resume draft" })).toBeVisible();
    mocks.routes.mockResolvedValueOnce([{ ...activeRoute, stops: [{ ...stop, kind: "DROP" }] }]);
    view.rerender(await LaundryTodayPage());
    expect(screen.getByText("Next: Harbour House drop-off")).toBeVisible();
  });

  it.each([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER])("preserves role access and route ownership for %s", async (role) => {
    mocks.requireRole.mockResolvedValue({ user: { id: "driver-1", role } });
    await LaundryTodayPage();
    expect(mocks.requireRole).toHaveBeenCalledWith([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.routes).toHaveBeenCalledWith({ where: {
      userId: "driver-1", date: expect.any(Date), status: { in: ["ACTIVE", "DRAFT"] },
    } });
  });

  it("preserves current query scope and counts all returned rows before the five-row preview", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T02:00:00Z"));
    const start = new Date("2026-09-08T14:00:00Z");
    const end = new Date("2026-09-09T14:00:00Z");
    const scheduledStart = new Date("2026-09-09T00:00:00Z");
    const scheduledEnd = new Date("2026-09-10T00:00:00Z");
    mocks.tasks.mockResolvedValue([
      task("1", LaundryStatus.PENDING), task("2", LaundryStatus.CONFIRMED),
      task("3", LaundryStatus.PICKED_UP), task("4", LaundryStatus.DROPPED, start),
      task("5", LaundryStatus.DROPPED, new Date(end.getTime() - 1)),
      task("6", LaundryStatus.DROPPED, end), task("7", LaundryStatus.DROPPED, null),
      task("8", LaundryStatus.FLAGGED), task("9", LaundryStatus.SKIPPED_PICKUP),
      task("10", LaundryStatus.DROPPED, new Date(start.getTime() - 1)),
    ]);
    render(await LaundryTodayPage());
    ["2", "1", "2", "10"].forEach((value, i) => expect(tile(labels[i]).getByText(value)).toBeVisible());
    expect(screen.getByText("House 5, Sydney")).toBeVisible();
    expect(screen.queryByText("House 6, Sydney")).not.toBeInTheDocument();
    expect(mocks.tasks).toHaveBeenCalledWith({
      where: { noPickupRequired: false, OR: [
        { pickupDate: { gte: scheduledStart, lt: scheduledEnd } }, { dropoffDate: { gte: scheduledStart, lt: scheduledEnd } },
        { droppedAt: { gte: start, lt: end } },
        { status: { in: [LaundryStatus.PICKED_UP, LaundryStatus.CONFIRMED] } },
      ] },
      orderBy: [{ pickupDate: "asc" }],
      select: { id: true, status: true, droppedAt: true, bagWeightKg: true, property: { select: { name: true, suburb: true } } },
    });
    expect(mocks.routes.mock.calls[0][0].where.date).toEqual(new Date("2026-09-09T00:00:00Z"));
  });

  it("counts more than 20 loads while limiting only the visible preview", async () => {
    mocks.tasks.mockResolvedValue(Array.from({ length: 31 }, (_, i) => task(String(i), LaundryStatus.CONFIRMED)));
    render(await LaundryTodayPage());
    expect(tile("In queue").getByText("31")).toBeVisible();
    expect(tile("In pipeline").getByText("31")).toBeVisible();
    expect(screen.getAllByText(/^House \d+, Sydney$/)).toHaveLength(5);
    expect(mocks.tasks.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it.each([
    ["2026-10-03T15:00:00Z", "2026-10-04", "2026-10-05", "2026-10-03T14:00:00Z", "2026-10-04T13:00:00Z", 23],
    ["2026-04-04T14:00:00Z", "2026-04-05", "2026-04-06", "2026-04-04T13:00:00Z", "2026-04-05T14:00:00Z", 25],
  ])("separates scheduled date keys from Sydney delivery instants at %s", async (now, today, tomorrow, start, end, hours) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    const firstInstant = new Date(start);
    const nextMidnight = new Date(end);
    mocks.tasks.mockResolvedValue([
      task("before", LaundryStatus.DROPPED, new Date(firstInstant.getTime() - 1)),
      task("first", LaundryStatus.DROPPED, firstInstant),
      task("last", LaundryStatus.DROPPED, new Date(nextMidnight.getTime() - 1)),
      task("after", LaundryStatus.DROPPED, nextMidnight),
    ]);
    render(await LaundryTodayPage());
    expect(tile("Delivered").getByText("2")).toBeVisible();
    const filters = mocks.tasks.mock.calls[0][0].where.OR;
    const scheduleRange = { gte: new Date(`${today}T00:00:00Z`), lt: new Date(`${tomorrow}T00:00:00Z`) };
    expect(filters[0]).toEqual({ pickupDate: scheduleRange });
    expect(filters[1]).toEqual({ dropoffDate: scheduleRange });
    expect(filters[2]).toEqual({ droppedAt: { gte: firstInstant, lt: nextMidnight } });
    expect((nextMidnight.getTime() - firstInstant.getTime()) / 3_600_000).toBe(hours);
    expect(mocks.routes.mock.calls[0][0].where.date).toEqual(scheduleRange.gte);
  });
});
