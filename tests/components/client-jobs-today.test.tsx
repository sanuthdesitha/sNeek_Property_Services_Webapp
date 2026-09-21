import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ClientJobsBoard } from "@/components/v2/client/jobs-board";
import { EstateCalendarGrid } from "@/components/v2/client/calendar-grid";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const key = "sneek_client_jobs_filter";
const job = (id: string, date: string) => ({ id, jobNumber: id, jobType: "REGULAR", status: "ASSIGNED", scheduledDate: `${date}T00:00:00Z`, startTime: null, dueTime: null, property: { id, name: id, suburb: null }, assignments: [], jobTasks: [], laundryTask: null, satisfactionRating: null });
const mount = () => render(<ClientJobsBoard jobs={[job("Today property", "2026-10-01"), job("Tomorrow property", "2026-10-02")]} showCleanerNames={false} showClientTaskRequests={false} showLaundryUpdates={false} />);
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T15:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });
it("defaults to Sydney today with a visible selected date", () => {
  mount(); expect(screen.getByLabelText("Filter by date")).toHaveValue("2026-10-01");
  expect(screen.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Today property", { selector: "p" })).toBeVisible(); expect(screen.queryByText("Tomorrow property", { selector: "p" })).not.toBeInTheDocument();
});
it("preserves an explicit stored date and restores its calendar month", () => {
  localStorage.setItem(key, JSON.stringify({ filterMode: "date", selectedDate: "2026-08-12", viewMode: "calendar" })); mount();
  expect(screen.getByLabelText("Filter by date")).toHaveValue("2026-08-12"); expect(screen.getByText("August 2026")).toBeVisible();
  expect(screen.getByRole("button", { name: "Select 2026-08-12" })).toHaveAttribute("aria-pressed", "true");
});
it("calendar Today resets an old selected day and date range while retaining other filters", () => {
  localStorage.setItem(key, JSON.stringify({ filterMode: "date", selectedDate: "2026-08-12", viewMode: "calendar" })); mount();
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-08-31" } });
  fireEvent.change(screen.getByLabelText("Filter by property"), { target: { value: "Today property" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Today", exact: true })[1]);
  expect(screen.getByLabelText("Filter by date")).toHaveValue("2026-10-01"); expect(screen.getByText("October 2026")).toBeVisible();
  expect(screen.getByLabelText("From date")).toHaveValue(""); expect(screen.getByLabelText("To date")).toHaveValue("");
  expect(screen.getByLabelText("Filter by property")).toHaveValue("Today property");
  expect(screen.getByRole("button", { name: "Select 2026-10-01" })).toHaveAttribute("aria-pressed", "true");
});
it("preserves an explicitly saved All preference", () => {
  localStorage.setItem(key, JSON.stringify({ filterMode: "all", selectedDate: "", viewMode: "list" })); mount();
  expect(screen.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true"); expect(screen.getByText("Tomorrow property", { selector: "p" })).toBeVisible();
});
it("restored Today uses the current Sydney day instead of yesterday's stored date", () => {
  localStorage.setItem(key, JSON.stringify({ filterMode: "today", selectedDate: "2026-09-30", viewMode: "list" })); mount();
  expect(screen.getByLabelText("Filter by date")).toHaveValue("2026-10-01");
});
it("invalid persisted calendar dates fall back to today", () => {
  localStorage.setItem(key, JSON.stringify({ filterMode: "date", selectedDate: "2026-02-31", viewMode: "invalid" })); mount();
  expect(screen.getByLabelText("Filter by date")).toHaveValue("2026-10-01");
});
it("standalone calendar uses Sydney month and Today after month navigation", () => {
  render(<EstateCalendarGrid events={[]} initialMonthKey="2026-07" />);
  expect(screen.getByText("July 2026")).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("August 2026")).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(screen.getByText("October 2026")).toBeVisible(); expect(screen.getByLabelText("2026-10-01")).toHaveAttribute("aria-current", "date");
});
