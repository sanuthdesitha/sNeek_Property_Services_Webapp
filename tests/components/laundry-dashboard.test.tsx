import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LaundryStatus, Role } from "@prisma/client";
import LaundryTodayPage from "@/app/v2/laundry/page";
import { classifyRuns, runTasks, todayRunsRange } from "@/lib/laundry/run-classification";

/**
 * Laundry portal Today. Owner decision 2026-11-13 ("Today's page shows
 * unwanted all failed things; only show what is scheduled today, as in the
 * Runs page"): every section now reads today's runs from the Runs board's
 * own feed query and rule (lib/laundry/run-classification.ts). Tests that
 * encoded the old content (every open set of any date, the "Live queue", the
 * old overdue stop list and the "In pipeline" count) were changed on purpose.
 */
const mocks = vi.hoisted(() => ({ feed: vi.fn(), stops: vi.fn(), requestTasks: vi.fn(), routes: vi.fn(), property: vi.fn(), requireRole: vi.fn(), audit: vi.fn(), replies: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  laundryTask: {
    // The Runs feed query (include), the route stop lookup (select stops) and the office-request lookup (select jobId).
    findMany: async (args: { include?: unknown; select?: { jobId?: unknown } }) => (args.include ? mocks.feed(args) : args.select?.jobId ? mocks.requestTasks(args) : mocks.stops(args)),
  },
  laundryRoute: { findMany: mocks.routes },
  // "Requests from the office" (2026-11-12): the audit rows of Ask laundry team requests.
  auditLog: { findMany: mocks.audit },
  // Typed answers to those requests (2026-11-12, LaundryTeamRequestReply).
  laundryTeamRequestReply: { findMany: mocks.replies },
  user: { findMany: async () => [] },
  // findMany answers the viewer-scope lookup: the properties this driver serves.
  property: { findUnique: mocks.property, findMany: async () => [{ id: "property-1", accessInfo: {}, laundryEnabled: true }] },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/components/v2/laundry/plan-brief", () => ({ PlanBrief: () => <div>Plan brief</div> }));
vi.mock("@/components/v2/laundry/route-map", () => ({ LaundryRouteMap: () => <div>Route map</div> }));

const NOW = new Date("2026-11-13T01:00:00Z"); // 12:00 in Sydney, Friday 13 November
const TODAY = "2026-11-13T00:00:00.000Z";
const YESTERDAY = "2026-11-12T00:00:00.000Z";
const LAST_WEEK = "2026-11-05T00:00:00.000Z";
const TOMORROW = "2026-11-14T00:00:00.000Z";

const labels = ["In queue", "In transit", "Delivered", "Runs today"];
const stop = { taskId: "today-pickup", propertyId: "property-1", kind: "PICKUP", order: 0 };
const activeRoute = { status: "ACTIVE", updatedAt: new Date("2026-11-13"), stops: [stop] };
function tile(label: string) { return within(screen.getByText(label, { selector: "p" }).parentElement!.parentElement!); }

type FeedTask = { id: string; status: LaundryStatus; pickupDate: string; dropoffDate: string; droppedAt?: Date | null; name?: string; suburb?: string | null; bagWeightKg?: number | null; property?: unknown };
function run(task: FeedTask) {
  return {
    noPickupRequired: false, droppedAt: null, bagWeightKg: 3, confirmations: [],
    property: task.property === undefined ? { name: task.name ?? `House ${task.id}`, suburb: task.suburb === undefined ? "Sydney" : task.suburb, accessInfo: {}, laundryEnabled: true } : task.property,
    ...task,
  };
}

/** The fixtures the owner described: today's runs, a failed run from yesterday, a flagged old run. */
const FIXTURES = [
  run({ id: "today-pickup", status: LaundryStatus.CONFIRMED, pickupDate: TODAY, dropoffDate: TOMORROW }),
  run({ id: "today-failed", status: LaundryStatus.FLAGGED, pickupDate: TODAY, dropoffDate: TOMORROW }),
  run({ id: "today-drop", status: LaundryStatus.PICKED_UP, pickupDate: YESTERDAY, dropoffDate: TODAY }),
  run({ id: "today-delivered", status: LaundryStatus.DROPPED, pickupDate: YESTERDAY, dropoffDate: TODAY, droppedAt: new Date("2026-11-12T23:30:00Z") }),
  run({ id: "yesterday-failed", status: LaundryStatus.FLAGGED, pickupDate: YESTERDAY, dropoffDate: TODAY }),
  run({ id: "old-flagged", status: LaundryStatus.FLAGGED, pickupDate: LAST_WEEK, dropoffDate: LAST_WEEK }),
  run({ id: "tomorrow", status: LaundryStatus.CONFIRMED, pickupDate: TOMORROW, dropoffDate: TOMORROW }),
];

const stopTask = (patch: Record<string, unknown> = {}) => ({ id: "today-pickup", status: "CONFIRMED", pickupDate: new Date(TODAY), dropoffDate: new Date(TOMORROW), pickupTime: "14:30", dropoffTime: null, pickedUpAt: null, droppedAt: null, dropoffCostAud: null, noPickupRequired: false, property: { name: "Harbour House", address: "1 Ocean St", suburb: "Manly" }, confirmations: [], ...patch });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.requireRole.mockResolvedValue({ user: { id: "driver-1", role: Role.LAUNDRY } });
  mocks.feed.mockResolvedValue([]);
  mocks.stops.mockResolvedValue([]);
  mocks.requestTasks.mockResolvedValue([]);
  mocks.routes.mockResolvedValue([]);
  mocks.property.mockResolvedValue({ name: "Harbour House" });
  mocks.audit.mockResolvedValue([]);
  mocks.replies.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("Today shows only what is scheduled today, by the Runs rule", () => {
  it("has the same set as the Runs page's today for the same fixtures", async () => {
    mocks.feed.mockResolvedValue(FIXTURES);
    mocks.stops.mockImplementation(async (args: { where: { id: { in: string[] } } }) => FIXTURES.filter((row) => args.where.id.in.includes(row.id)).map((row) => stopTask({ id: row.id, status: row.status, property: { name: row.property.name, address: "1 St", suburb: "Sydney" } })));
    render(await LaundryTodayPage());
    const runsSet = runTasks(classifyRuns(FIXTURES, todayRunsRange(NOW))).map((row) => row.id).sort();
    expect(runsSet).toEqual(["today-delivered", "today-drop", "today-failed", "today-pickup"]);
    const card = screen.getByRole("heading", { name: "Today's runs" }).closest("div.e-card, section, article, div")!.parentElement!.parentElement as HTMLElement;
    for (const id of runsSet) expect(within(card).getByText(`House ${id}, Sydney`)).toBeVisible();
    for (const id of ["yesterday-failed", "old-flagged", "tomorrow"]) expect(screen.queryByText(new RegExp(`House ${id}`))).not.toBeInTheDocument();
    // A run scheduled today that failed today still shows, marked with its state.
    expect(within(card).getByText("Flagged")).toBeVisible();
    ["1", "1", "1", "4"].forEach((value, i) => expect(tile(labels[i]).getByText(value)).toBeVisible());
    // The feed query is the Runs board's: today's window, plus flagged sets the rule then drops.
    const where = mocks.feed.mock.calls[0][0].where;
    expect(where.propertyId).toEqual({ in: ["property-1"] });
    expect(where.OR).toEqual([
      { pickupDate: { gte: new Date("2026-11-12T13:00:00Z"), lt: new Date("2026-11-13T13:00:00Z") } },
      { dropoffDate: { gte: new Date("2026-11-12T13:00:00Z"), lt: new Date("2026-11-13T13:00:00Z") } },
      { status: "FLAGGED" },
    ]);
    // Without a route the stop list is exactly today's loops (no overdue sets).
    expect(mocks.stops.mock.calls[0][0].where.id.in.sort()).toEqual(runsSet);
    expect(screen.queryByText(/Pickup · House yesterday-failed/)).not.toBeInTheDocument();
  });

  it("leaves route stops from other days off Today and says where they are", async () => {
    mocks.feed.mockResolvedValue(FIXTURES);
    mocks.routes.mockResolvedValue([{ ...activeRoute, startedAt: new Date("2026-11-12T22:10:00Z"), stops: [stop, { taskId: "old-flagged", propertyId: "property-1", kind: "PICKUP", order: 1 }] }]);
    mocks.stops.mockResolvedValue([stopTask(), stopTask({ id: "old-flagged", status: "FLAGGED", property: { name: "Old House", address: "2 St", suburb: "Bondi" } })]);
    render(await LaundryTodayPage());
    expect(screen.getByText("Pickup · Harbour House")).toBeVisible();
    expect(screen.queryByText("Pickup · Old House")).not.toBeInTheDocument();
    expect(screen.getByText(/1 stop on your route is not scheduled today/)).toBeVisible();
    expect(screen.getByRole("link", { name: "See them in Tracking" })).toHaveAttribute("href", "/v2/laundry/tracking");
  });

  it("keeps runs from other days reachable from Today", async () => {
    render(await LaundryTodayPage());
    expect(screen.getByRole("link", { name: "View all →" })).toHaveAttribute("href", "/v2/laundry/runs");
    expect(screen.getByRole("link", { name: "Tracking" })).toHaveAttribute("href", "/v2/laundry/tracking");
    expect(screen.getByRole("link", { name: "Queue" })).toHaveAttribute("href", "/v2/laundry/queue");
  });
});

describe("laundry dashboard reliability", () => {
  it("preserves genuine empty queries and zero totals", async () => {
    render(await LaundryTodayPage());
    labels.forEach((label) => expect(tile(label).getByText("0")).toBeVisible());
    expect(screen.getByText("No runs today")).toBeVisible();
    expect(screen.getByRole("link", { name: "Build route" })).toHaveAttribute("href", "/v2/laundry/route");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Changed on purpose (2026-11-13): the route is filtered to today's runs, so
  // when today's runs cannot be read the route is shown as unavailable too.
  it("shows unreadable runs as unavailable (route included), then recovers", async () => {
    mocks.feed.mockRejectedValueOnce(new Error("offline"));
    mocks.routes.mockResolvedValue([activeRoute]);
    const view = render(await LaundryTodayPage());
    labels.forEach((label) => expect(tile(label).getByText("Unavailable")).toBeVisible());
    expect(screen.queryByText("No runs today")).not.toBeInTheDocument();
    expect(screen.getByText("Today's route is unavailable.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Retry laundry" })).toHaveAttribute("href", "/v2/laundry");
    view.rerender(await LaundryTodayPage());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit route order/ })).toHaveAttribute("href", "/v2/laundry/route");
  });

  it("isolates route failures from present laundry totals and rows", async () => {
    mocks.routes.mockRejectedValueOnce(new Error("offline"));
    mocks.feed.mockResolvedValue([run({ id: "1", status: LaundryStatus.PENDING, pickupDate: TODAY, dropoffDate: TOMORROW }), run({ id: "2", status: LaundryStatus.PICKED_UP, pickupDate: YESTERDAY, dropoffDate: TODAY })]);
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
    mocks.feed.mockRejectedValue(new Error("offline"));
    mocks.routes.mockRejectedValue(new Error("offline"));
    render(await LaundryTodayPage());
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByText("Plan brief")).toBeVisible();
    expect(screen.getByText("Route map")).toBeVisible();
    expect(screen.queryByText("No runs today")).not.toBeInTheDocument();
  });

  // Route card replaced by the Today route list (board "Laundry partner portal", 2026-11-12): changed on purpose.
  it("lists the active route in order with planned times and goes to the current stop", async () => {
    mocks.feed.mockResolvedValue(FIXTURES);
    mocks.routes.mockResolvedValue([{ ...activeRoute, startedAt: new Date("2026-11-12T22:10:00Z") }]);
    mocks.stops.mockResolvedValue([stopTask()]);
    render(await LaundryTodayPage());
    expect(screen.getByText(/Route started 9:10 · stop 1 of 1/)).toBeVisible();
    expect(screen.getByText("Pickup · Harbour House")).toBeVisible();
    expect(screen.getByText("14:30")).toBeVisible();
    expect(screen.getByText("Cleaner has not confirmed bags")).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to stop 1 · Harbour House" })).toHaveAttribute("href", "/v2/laundry/stop/today-pickup?kind=pickup");
    expect(screen.getByRole("link", { name: /Open in Maps/ }).getAttribute("href")).toContain("google.com/maps");
  });

  it("prefers active routes over drafts and preserves completed progress", async () => {
    mocks.feed.mockResolvedValue(FIXTURES);
    mocks.routes.mockResolvedValue([
      { status: "DRAFT", updatedAt: new Date("2026-11-13"), stops: [] },
      { ...activeRoute, stops: [{ ...stop, completedAt: "2026-11-13T00:00:00Z" }] },
    ]);
    mocks.stops.mockResolvedValue([stopTask()]);
    render(await LaundryTodayPage());
    expect(screen.getByText("All stops done.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Go to stop/ })).not.toBeInTheDocument();
  });

  it("offers an existing draft for resumption", async () => {
    mocks.feed.mockResolvedValue(FIXTURES);
    mocks.routes.mockResolvedValue([{ ...activeRoute, status: "DRAFT" }]);
    mocks.stops.mockResolvedValue([stopTask()]);
    render(await LaundryTodayPage());
    expect(screen.getByText(/Your route draft is waiting/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Resume draft route" })).toHaveAttribute("href", "/v2/laundry/route");
  });

  it("renders today's exception statuses and missing property or weight without hiding a load", async () => {
    mocks.feed.mockResolvedValue([
      run({ id: "flag", status: LaundryStatus.FLAGGED, pickupDate: TODAY, dropoffDate: TOMORROW, bagWeightKg: null, property: { name: null, suburb: null, accessInfo: {}, laundryEnabled: true } }),
      run({ id: "nosub", status: LaundryStatus.CONFIRMED, pickupDate: TODAY, dropoffDate: TOMORROW, name: "No suburb", suburb: null }),
    ]);
    render(await LaundryTodayPage());
    expect(screen.getByText("Flagged")).toBeVisible();
    expect(screen.getByText("Confirmed")).toBeVisible();
    expect(screen.getByText("Weight t.b.c.")).toBeVisible();
    expect(screen.getByText("Property")).toBeVisible();
    expect(screen.getByText("No suburb")).toBeVisible();
  });

  it("handles multiple route drafts and a drop-off next stop", async () => {
    mocks.feed.mockResolvedValue(FIXTURES);
    mocks.stops.mockResolvedValue([stopTask({ id: "today-drop", status: "PICKED_UP" })]);
    const dropStop = { ...stop, taskId: "today-drop" };
    mocks.routes.mockResolvedValueOnce([
      { ...activeRoute, status: "DRAFT", updatedAt: new Date("2026-11-12"), stops: [dropStop] },
      { ...activeRoute, status: "DRAFT", updatedAt: new Date("2026-11-13"), stops: [dropStop] },
    ]);
    const view = render(await LaundryTodayPage());
    expect(screen.getByRole("link", { name: "Resume draft route" })).toBeVisible();
    mocks.routes.mockResolvedValueOnce([{ ...activeRoute, stops: [{ ...dropStop, kind: "DROP" }] }]);
    view.rerender(await LaundryTodayPage());
    expect(screen.getByText("Drop · Harbour House")).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to stop 1 · Harbour House" })).toHaveAttribute("href", "/v2/laundry/stop/today-drop?kind=drop");
  });

  it.each([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER])("preserves role access and route ownership for %s", async (role) => {
    mocks.requireRole.mockResolvedValue({ user: { id: "driver-1", role } });
    await LaundryTodayPage();
    expect(mocks.requireRole).toHaveBeenCalledWith([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.routes).toHaveBeenCalledWith({ where: {
      userId: "driver-1", date: expect.any(Date), status: { in: ["ACTIVE", "DRAFT"] },
    } });
  });

  it("counts every run before the five-row preview", async () => {
    mocks.feed.mockResolvedValue(Array.from({ length: 31 }, (_, i) => run({ id: String(i), status: LaundryStatus.CONFIRMED, pickupDate: TODAY, dropoffDate: TOMORROW })));
    render(await LaundryTodayPage());
    expect(tile("In queue").getByText("31")).toBeVisible();
    expect(tile("Runs today").getByText("31")).toBeVisible();
    expect(screen.getAllByText(/^House \d+, Sydney$/)).toHaveLength(5);
    expect(mocks.feed.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it.each([
    ["2026-10-03T15:00:00Z", "2026-10-04", "2026-10-03T14:00:00Z", "2026-10-04T13:00:00Z", 23],
    ["2026-04-04T14:00:00Z", "2026-04-05", "2026-04-04T13:00:00Z", "2026-04-05T14:00:00Z", 25],
  ])("uses the Sydney day across daylight saving at %s", async (now, today, start, end, hours) => {
    vi.setSystemTime(new Date(now));
    const firstInstant = new Date(start);
    const nextMidnight = new Date(end);
    const scheduled = `${today}T00:00:00.000Z`;
    mocks.feed.mockResolvedValue([
      run({ id: "before", status: LaundryStatus.DROPPED, pickupDate: scheduled, dropoffDate: scheduled, droppedAt: new Date(firstInstant.getTime() - 1) }),
      run({ id: "first", status: LaundryStatus.DROPPED, pickupDate: scheduled, dropoffDate: scheduled, droppedAt: firstInstant }),
      run({ id: "last", status: LaundryStatus.DROPPED, pickupDate: scheduled, dropoffDate: scheduled, droppedAt: new Date(nextMidnight.getTime() - 1) }),
      run({ id: "after", status: LaundryStatus.DROPPED, pickupDate: scheduled, dropoffDate: scheduled, droppedAt: nextMidnight }),
    ]);
    render(await LaundryTodayPage());
    expect(tile("Delivered").getByText("2")).toBeVisible();
    expect(mocks.feed.mock.calls[0][0].where.OR[0]).toEqual({ pickupDate: { gte: firstInstant, lt: nextMidnight } });
    expect((nextMidnight.getTime() - firstInstant.getTime()) / 3_600_000).toBe(hours);
    expect(mocks.routes.mock.calls[0][0].where.date).toEqual(new Date(scheduled));
  });

  it("lists only tasks at the properties this driver serves", async () => {
    render(await LaundryTodayPage());
    expect(mocks.feed.mock.calls[0][0].where.propertyId).toEqual({ in: ["property-1"] });
  });
});

describe("From the office (Ask laundry team)", () => {
  const requestTask = (id: string, pickupDate: string) => ({ id, jobId: "j9", status: LaundryStatus.CONFIRMED, pickupDate: new Date(pickupDate), dropoffDate: new Date(TOMORROW), pickedUpAt: null, flagReason: null, pickupTime: null, dropoffTime: null, supplier: { avgTurnaround: null }, property: { name: id === "task-9" ? "Harbour House" : "Old House", suburb: "Manly" }, job: { status: "COMPLETED" }, confirmations: [] });
  // Today's pickup with no bag answer yet can be asked to move; last week's overdue pickup to be confirmed.
  const ask = (id: string, taskId: string) => ({ id, entityId: taskId, createdAt: new Date("2026-11-12T23:00:00Z"), after: { kind: taskId === "task-9" ? "TEAM_MOVE_PICKUP" : "TEAM_CONFIRM_PICKUP", note: "Gate code 1234", recipientIds: ["driver-1"] } });

  // The Today card summarises; answers are given in From the office (2026-11-12). Changed on
  // purpose (2026-11-13): only the open requests about TODAY's runs are listed; the inbox has all.
  it("shows the open requests about today's runs and the way into the inbox", async () => {
    mocks.feed.mockResolvedValue([run({ id: "task-9", status: LaundryStatus.CONFIRMED, pickupDate: TODAY, dropoffDate: TOMORROW })]);
    mocks.audit.mockResolvedValue([ask("a1", "task-9"), ask("a2", "task-old")]);
    mocks.requestTasks.mockResolvedValue([requestTask("task-9", TODAY), requestTask("task-old", LAST_WEEK)]);
    render(await LaundryTodayPage());
    const card = screen.getByRole("heading", { name: "From the office" }).closest("#office-requests") as HTMLElement;
    expect(within(card).getByText("1 open today")).toBeVisible();
    expect(within(card).getByText(/Harbour House/)).toBeVisible();
    expect(within(card).queryByText(/Old House/)).not.toBeInTheDocument();
    expect(within(card).getByText("1 more open about other days.")).toBeVisible();
    expect(within(card).getByRole("link", { name: /Answer in From the office/ })).toHaveAttribute("href", "/v2/laundry/requests");
    expect(mocks.audit.mock.calls[0][0].where).toMatchObject({ action: "LAUNDRY_TEAM_REQUEST_SENT", after: { path: ["recipientIds"], array_contains: ["driver-1"] } });
  });

  it("says the requests could not be loaded instead of showing none", async () => {
    mocks.audit.mockRejectedValue(new Error("offline"));
    render(await LaundryTodayPage());
    expect(screen.getByText("Requests from the office could not be loaded.")).toBeVisible();
  });
});
