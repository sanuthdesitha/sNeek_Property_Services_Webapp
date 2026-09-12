import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CalendarJob } from "@/components/v2/cleaner/estate-calendar";
import V2CleanerCalendarPage from "@/app/v2/cleaner/calendar/page";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), requireRole: vi.fn(), access: vi.fn(), calendar: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: mocks.findMany } } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/portal-access", () => ({ ensureCleanerModuleAccess: mocks.access }));
vi.mock("@/components/v2/cleaner/estate-calendar", () => ({
  EstateCalendar: (props: { jobs: CalendarJob[]; monthKey?: string; todayKey?: string }) => {
    mocks.calendar(props);
    return <div data-testid="calendar">{props.jobs.length ? `${props.jobs.length} assigned jobs` : "No jobs this month"}</div>;
  },
}));

function job(overrides = {}) {
  return {
    id: "job-1", status: "ASSIGNED", jobType: "END_OF_LEASE",
    scheduledDate: new Date("2026-09-30T14:00:00Z"), startTime: "09:00", dueTime: "13:00",
    internalNotes: null, sameDayCheckin: true, sameDayCheckinTime: "15:00", assignments: [{ responseStatus: "ACCEPTED" }],
    property: { name: "Harbour apartment", suburb: "Manly" }, ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  // Already October in Sydney, still September in UTC.
  vi.setSystemTime(new Date("2026-09-30T14:30:00Z"));
  mocks.requireRole.mockResolvedValue({ user: { id: "cleaner-7" } });
  mocks.access.mockResolvedValue(undefined);
  mocks.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("cleaner calendar server page", () => {
  it("queries the full selected Sydney month with exact active ownership and selection", async () => {
    render(await V2CleanerCalendarPage({ searchParams: { month: "2026-10" } }));
    expect(mocks.access).toHaveBeenCalledWith("calendar");
    expect(mocks.requireRole).toHaveBeenCalledWith(["CLEANER"]);
    expect(mocks.findMany).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        assignments: { some: { userId: "cleaner-7", removedAt: null } },
        scheduledDate: { gte: new Date("2026-09-30T14:00:00Z"), lt: new Date("2026-10-31T13:00:00Z") },
      },
      select: {
        id: true, status: true, jobType: true, scheduledDate: true, startTime: true, dueTime: true,
        internalNotes: true, sameDayCheckin: true, sameDayCheckinTime: true,
        assignments: { where: { userId: "cleaner-7", removedAt: null }, select: { responseStatus: true } },
        property: { select: { name: true, suburb: true } },
      },
      orderBy: [{ scheduledDate: "asc" }],
    });
    expect(mocks.calendar).toHaveBeenCalledWith({ jobs: [], monthKey: "2026-10", todayKey: "2026-10-01" });
  });

  it.each([
    ["2026-04", "2026-03-31T13:00:00Z", "2026-04-30T14:00:00Z"],
    ["2026-12", "2026-11-30T13:00:00Z", "2026-12-31T13:00:00Z"],
    ["2000-01", "1999-12-31T13:00:00Z", "2000-01-31T13:00:00Z"],
    ["2100-12", "2100-11-30T13:00:00Z", "2100-12-31T13:00:00Z"],
  ])("bounds %s by Sydney midnight, including DST and year rollover", async (month, start, end) => {
    render(await V2CleanerCalendarPage({ searchParams: { month } }));
    expect(mocks.findMany.mock.calls[0][0].where.scheduledDate).toEqual({ gte: new Date(start), lt: new Date(end) });
    expect(mocks.calendar.mock.calls[0][0].monthKey).toBe(month);
  });

  it.each([
    ["2026-09-30T14:00:00Z", "2026-10-01"],
    ["2026-10-04T12:59:59Z", "2026-10-04"],
    ["2026-10-04T13:00:00Z", "2026-10-05"],
    ["2026-04-05T13:59:59Z", "2026-04-05"],
    ["2026-04-05T14:00:00Z", "2026-04-06"],
  ])("groups %s on Sydney day %s", async (instant, dateKey) => {
    mocks.findMany.mockResolvedValue([job({ scheduledDate: new Date(instant) })]);
    render(await V2CleanerCalendarPage({ searchParams: { month: dateKey.slice(0, 7) } }));
    expect(mocks.calendar.mock.calls[0][0].jobs[0].dateKey).toBe(dateKey);
  });

  it("maps due time, pending ownership response and derived timing badges without exposing notes", async () => {
    mocks.findMany.mockResolvedValue([job({
      assignments: [{ responseStatus: "PENDING" }],
      internalNotes: JSON.stringify({ version: 1, internalNoteText: "PRIVATE ADMIN NOTE",
        earlyCheckin: { enabled: true, preset: "11:00" },
        lateCheckout: { enabled: true, preset: "custom", time: "12:45" } }),
    }), job({ id: "job-2", startTime: null, dueTime: null, internalNotes: "PRIVATE PLAIN NOTE" })]);
    render(await V2CleanerCalendarPage({}));
    const { jobs } = mocks.calendar.mock.calls[0][0];
    expect(jobs[0]).toEqual({
      id: "job-1", dateKey: "2026-10-01", title: "Harbour apartment", subtitle: "Manly · End Of Lease",
      startTime: "09:00", dueTime: "13:00", status: "Assigned", rawStatus: "ASSIGNED",
      pendingOffer: true, timingBadges: { early: "11:00", late: "12:45" }, tone: "primary",
      sameDayCheckin: true, sameDayCheckinTime: "15:00",
    });
    expect(jobs[1]).toMatchObject({ startTime: null, dueTime: null, timingBadges: null, pendingOffer: false });
    for (const dto of jobs) expect(dto).not.toHaveProperty("internalNotes");
    expect(JSON.stringify(jobs)).not.toContain("PRIVATE");
  });

  it("passes every assigned job returned for the month beyond the old 400 cap", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 450 }, (_, i) => job({ id: `job-${i}` })));
    render(await V2CleanerCalendarPage({}));
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(mocks.calendar.mock.calls[0][0].jobs).toHaveLength(450);
  });

  it.each([undefined, "", "2026-1", "2026-00", "2026-13", "1999-12", "2101-01", "1900-01", "9999-01",
    "2026-10-01", " 2026-10", "2026-10\n", "garbage", ["2026-04"], ["2026-04", "2026-10"]])(
    "falls back to the current Sydney month for invalid month %j", async (month) => {
      render(await V2CleanerCalendarPage({ searchParams: { month } }));
      expect(mocks.calendar.mock.calls[0][0]).toMatchObject({ monthKey: "2026-10", todayKey: "2026-10-01" });
      expect(mocks.findMany.mock.calls[0][0].where.scheduledDate).toEqual({
        gte: new Date("2026-09-30T14:00:00Z"), lt: new Date("2026-10-31T13:00:00Z"),
      });
    },
  );

  it.each([["2026-04", "2026-04"], ["invalid", "2026-10"]])(
    "renders read failure with a native reload link to validated month %s", async (month, validated) => {
      mocks.findMany.mockRejectedValue(new Error("private database failure"));
      render(await V2CleanerCalendarPage({ searchParams: { month } }));
      expect(screen.getByRole("alert")).toHaveTextContent("Unable to load your calendar");
      const retry = screen.getByRole("link", { name: "Retry" });
      expect(retry.tagName).toBe("A");
      expect(retry).toHaveAttribute("href", `/v2/cleaner/calendar?month=${validated}`);
      expect(screen.queryByText("No jobs this month")).not.toBeInTheDocument();
      expect(screen.queryByTestId("calendar")).not.toBeInTheDocument();
      expect(mocks.calendar).not.toHaveBeenCalled();
      expect(screen.queryByText(/private database failure/)).not.toBeInTheDocument();
    },
  );

  it("renders successful empty results as a calendar, not an error", async () => {
    render(await V2CleanerCalendarPage({}));
    expect(screen.getByText("No jobs this month")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Retry" })).not.toBeInTheDocument();
  });

  it.each(["module", "role"])("does not turn %s access failures into read errors", async (gate) => {
    const error = new Error("access denied");
    (gate === "module" ? mocks.access : mocks.requireRole).mockRejectedValue(error);
    await expect(V2CleanerCalendarPage({})).rejects.toBe(error);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
