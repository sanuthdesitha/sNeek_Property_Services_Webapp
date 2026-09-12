import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EstateCalendar, type CalendarJob } from "@/components/v2/cleaner/estate-calendar";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/v2/cleaner/calendar" }));
vi.mock("@/components/v2/cleaner/job-offer-actions", () => ({ JobOfferActions: () => <button>Accept offer</button> }));
const job: CalendarJob = { id: "j-1", dateKey: "2026-09-09", title: "QA Harbour", subtitle: "Sydney", startTime: "10:00", dueTime: "12:00", status: "Assigned", tone: "primary", timingBadges: { late: "10:30", early: "13:00" } };
const props = { jobs: [job], monthKey: "2026-09", todayKey: "2026-09-09" };
beforeEach(() => { sessionStorage.clear(); mocks.push.mockReset(); });

describe("cleaner month calendar", () => {
  it("does not display malformed planned times as usable schedule times", () => {
    render(<EstateCalendar {...props} jobs={[{ ...job, startTime: "29:00", dueTime: "12:90" }]} />);
    expect(screen.queryByText(/29:00|12:90/)).toBeNull();
    expect(screen.getByText("Not set")).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent("Some timing information is invalid.");
  });
  it("retains a valid finish when the planned start is missing", () => {
    render(<EstateCalendar {...props} jobs={[{ ...job, startTime: null }]} />);
    expect(screen.getByText("Planned finish: 12:00")).toBeVisible();
    expect(screen.getByText("Not set")).toBeVisible();
  });
  it("separates planned times from guest timing constraints", () => {
    render(<EstateCalendar {...props} />);
    expect(screen.getByText("Planned start")).toBeVisible();
    expect(screen.getByText("Planned finish: 12:00")).toBeVisible();
    expect(screen.getByText("Late checkout: Start after 10:30")).toBeVisible();
    expect(screen.getByText("Early check-in: Ready by 13:00")).toBeVisible();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/v2/cleaner/jobs/j-1");
  });
  it("names day buttons with date/count and current selection", () => {
    render(<EstateCalendar {...props} />);
    const today = screen.getByRole("button", { name: "2026-09-09, 1 job" });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "2026-09-10, 0 jobs" }));
    expect(screen.getByText("No jobs on this day.")).toBeVisible();
  });
  it("navigates month through the server URL rather than an incomplete historical cache", () => {
    render(<EstateCalendar {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(mocks.push).toHaveBeenCalledWith("/v2/cleaner/calendar?month=2026-10", { scroll: false });
  });
  it("selects a day in the new month when server props change", () => {
    const view = render(<EstateCalendar {...props} />);
    view.rerender(<EstateCalendar {...props} monthKey="2026-10" jobs={[{ ...job, dateKey: "2026-10-01" }]} />);
    expect(screen.getByRole("button", { name: "2026-10-01, 1 job" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("QA Harbour")).toBeVisible();
  });
  it("shows the selected month's agenda including past days and excludes another month", () => {
    render(<EstateCalendar {...props} jobs={[{ ...job, dateKey: "2026-09-01" }, { ...job, id: "j-2", title: "Other month", dateKey: "2026-10-01" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));
    expect(screen.getByText("QA Harbour")).toBeVisible();
    expect(screen.queryByText("Other month")).toBeNull();
    expect(screen.getByRole("button", { name: "Next month" })).toBeVisible();
  });
  it("describes an empty month without claiming no future assignments", () => {
    render(<EstateCalendar {...props} jobs={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));
    expect(screen.getByText("No jobs this month")).toBeVisible();
    expect(screen.queryByText("No upcoming jobs")).toBeNull();
  });
  it("Today returns from another month to the supplied Sydney day", () => {
    render(<EstateCalendar {...props} monthKey="2026-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(mocks.push).toHaveBeenCalledWith("/v2/cleaner/calendar?month=2026-09", { scroll: false });
  });
  it("keeps offer actions outside navigation links", () => {
    render(<EstateCalendar {...props} jobs={[{ ...job, pendingOffer: true }]} />);
    expect(screen.getByRole("button", { name: "Accept offer" }).closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute("href", "/v2/cleaner/jobs/j-1");
  });
});
