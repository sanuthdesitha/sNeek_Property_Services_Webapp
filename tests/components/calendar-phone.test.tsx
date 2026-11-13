import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspace } from "@/components/v2/admin/calendar/calendar-workspace";
import { cleanerFlag, weekStripDay } from "@/components/v2/admin/calendar/calendar-phone-model";
import { calendarJob, calendarResponse } from "../lib/calendar-fixtures";

/**
 * Phone calendar (below 640px, board "Admin phone: Calendar"): week strip,
 * day agenda grouped by cleaner, and the "Move or reassign" sheet, which must
 * use the SAME check-move request and the SAME save calls as a drag.
 */
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/v2/admin/calendar",
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

type Call = { url: string; method: string; body: unknown; resolve: (body: unknown, status?: number) => void };
let calls: Call[];
const REFERENCE = ["/api/admin/clients", "/api/admin/properties", "/api/admin/users"];
const callsTo = (fragment: string) => calls.filter((call) => call.url.includes(fragment));
const lastCalendar = () => callsTo("/api/admin/calendar?").at(-1)!;
const posts = () => calls.filter((call) => call.method === "POST").map((call) => call.url);

async function answer(call: Call, body: unknown, status = 200) {
  await act(async () => { call.resolve(body, status); });
}

const unassigned = calendarJob({ id: "free", propertyName: "Coogee Terrace", cleaners: [], status: "UNASSIGNED", day: "2026-11-11", startTime: "11:30" });
const janes = calendarJob({ id: "jane-job", propertyName: "Bondi Studio", day: "2026-11-11", guestArrival: { time: "15:00" } });
const later = calendarJob({ id: "later", propertyName: "Manly Loft", day: "2026-11-12" });

function phoneMedia(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? phone : query.includes("min-width") ? !phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  calls = [];
  window.history.replaceState(null, "", "/v2/admin/calendar?view=day&date=2026-11-11");
  window.localStorage.clear();
  window.sessionStorage.clear();
  phoneMedia(true);
  vi.stubGlobal("fetch", vi.fn((url: string, options: RequestInit = {}) => {
    if (REFERENCE.some((prefix) => url.startsWith(prefix))) return Promise.resolve({ ok: true, status: 200, json: async () => [] });
    return new Promise((resolve) => {
      calls.push({
        url, method: options.method ?? "GET", body: options.body ? JSON.parse(String(options.body)) : null,
        resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }),
      });
    });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function renderPhoneDay() {
  render(<CalendarWorkspace />);
  await answer(lastCalendar(), calendarResponse([unassigned, janes, later]));
}

function card(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`${name}.*Open preview`) }).closest<HTMLElement>("[data-job-chip]")!;
}

describe("Calendar on a phone", () => {
  it("reads the week around the day for the strip, and lists only that day grouped Unassigned first", async () => {
    await renderPhoneDay();
    expect(lastCalendar().url).toContain("start=2026-11-09&end=2026-11-15");
    const strip = screen.getByRole("navigation", { name: "Week" });
    expect(within(strip).getByRole("button", { name: /^(Wed|Today) 11: 2 jobs, 1 without a cleaner$/ })).toHaveAttribute("aria-current", "date");
    expect(within(strip).getByRole("button", { name: /^(Thu|Today) 12: 1 job$/ })).toBeVisible();
    expect(screen.getByText(/Wed 11 November · 2 jobs · 1 without a cleaner|2 jobs · 1 without a cleaner/)).toBeVisible();
    const agenda = document.querySelector("[data-calendar-phone-agenda]")!;
    expect(agenda.textContent).toMatch(/Unassigned · 1.*Jane C\./);
    expect(agenda.textContent).not.toContain("Manly Loft");
    expect(within(card("Bondi Studio")).getByText("Guest in 15:00")).toBeVisible();
  });

  it("tapping a day in the strip opens that day", async () => {
    await renderPhoneDay();
    fireEvent.click(screen.getByRole("button", { name: /^(Thu|Today) 12: 1 job$/ }));
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-11-12");
    expect(new URLSearchParams(window.location.search).get("view")).toBe("day");
  });

  it("Move or reassign sheet: check-move with the drag's request, then the drag's assign save", async () => {
    await renderPhoneDay();
    fireEvent.click(within(card("Bondi Studio")).getByRole("button", { name: "Move or reassign" }));
    const sheet = screen.getByRole("dialog", { name: "Move or reassign" });
    fireEvent.click(within(sheet).getByRole("radio", { name: /Aiko T\./ }));
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Check move" })); });
    const check = callsTo("/api/admin/calendar/check-move")[0];
    expect(check.body).toEqual({ jobId: "jane-job", toDate: "2026-11-11", fromCleanerId: "u1", toCleanerId: "u2" });
    await answer(check, {
      jobId: "jane-job", propertyName: "Bondi Studio", fromDate: "2026-11-11", toDate: "2026-11-11", toCleanerName: "Aiko T.", blockers: [], warnings: [],
      plan: { reschedule: null, assign: { userIds: ["u2"], primaryUserId: "u2" } },
    });
    expect(within(sheet).getByText("Give Bondi Studio on Wed 11 Nov to Aiko T.?")).toBeVisible();
    expect(within(sheet).getByText("No clashes or roster gaps found.")).toBeVisible();
    // No confirmation dialog on top of the sheet: the sheet is the confirmation.
    expect(screen.queryByRole("button", { name: "Confirm move" })).toBeNull();
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Save move" })); });
    const assign = callsTo("/api/admin/jobs/jane-job/assign")[0];
    expect(assign.body).toEqual({ userIds: ["u2"], primaryUserId: "u2" });
    await answer(assign, {});
    expect(screen.queryByRole("dialog", { name: "Move or reassign" })).toBeNull();
    expect(posts()).toEqual(["/api/admin/calendar/check-move", "/api/admin/jobs/jane-job/assign"]);
  });

  it("a day and start change goes through check-move with toStartTime, then the reschedule endpoint", async () => {
    await renderPhoneDay();
    fireEvent.click(within(card("Bondi Studio")).getByRole("button", { name: "Move or reassign" }));
    const sheet = screen.getByRole("dialog", { name: "Move or reassign" });
    fireEvent.change(within(sheet).getByLabelText("Day"), { target: { value: "2026-11-13" } });
    fireEvent.change(within(sheet).getByLabelText("Start"), { target: { value: "12:00" } });
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Check move" })); });
    const check = callsTo("/api/admin/calendar/check-move")[0];
    expect(check.body).toEqual({ jobId: "jane-job", toDate: "2026-11-13", fromCleanerId: null, toCleanerId: null, toStartTime: "12:00" });
    await answer(check, {
      jobId: "jane-job", propertyName: "Bondi Studio", fromDate: "2026-11-11", toDate: "2026-11-13", toCleanerName: null, blockers: [], warnings: [],
      time: { fromStart: "10:00", toStart: "12:00", fromDue: "14:00", toDue: "16:00" },
      plan: { reschedule: { date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z", startTime: "12:00", dueTime: "16:00" }, assign: null },
    });
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Save move" })); });
    const reschedule = callsTo("/reschedule/")[0];
    expect(reschedule.url).toBe("/api/admin/phase4/reschedule/jane-job/apply");
    expect(reschedule.body).toEqual({ date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z", reason: "Moved on the calendar", startTime: "12:00", dueTime: "16:00" });
  });

  it("a refused move says nothing was changed and offers no save", async () => {
    await renderPhoneDay();
    fireEvent.click(within(card("Bondi Studio")).getByRole("button", { name: "Move or reassign" }));
    const sheet = screen.getByRole("dialog", { name: "Move or reassign" });
    fireEvent.change(within(sheet).getByLabelText("Day"), { target: { value: "2026-11-13" } });
    await act(async () => { fireEvent.click(within(sheet).getByRole("button", { name: "Check move" })); });
    await answer(callsTo("/api/admin/calendar/check-move")[0], {
      jobId: "jane-job", propertyName: "Bondi Studio", fromDate: "2026-11-11", toDate: "2026-11-13", toCleanerName: null,
      blockers: ["The booking ends before this day."], warnings: [], plan: { reschedule: null, assign: null },
    });
    expect(within(sheet).getByRole("alert")).toHaveTextContent("This move cannot be made. Nothing was changed.");
    expect(within(sheet).queryByRole("button", { name: "Save move" })).toBeNull();
    expect(posts()).toEqual(["/api/admin/calendar/check-move"]);
  });

  it("from 640px up the drag layout and its dialog are unchanged (no strip, no sheet)", async () => {
    phoneMedia(false);
    window.history.replaceState(null, "", "/v2/admin/calendar?view=week&date=2026-11-11");
    render(<CalendarWorkspace />);
    expect(lastCalendar().url).toContain("start=2026-11-09&end=2026-11-15");
    await answer(lastCalendar(), calendarResponse([unassigned, janes, later]));
    expect(screen.queryByRole("navigation", { name: "Week" })).toBeNull();
    expect(document.querySelector("[data-calendar-phone-agenda]")).toBeNull();
    expect(screen.getAllByRole("group", { name: "View" })).toHaveLength(1);
  });
});

describe("phone calendar model", () => {
  it("counts a day only when it is loaded, and flags unassigned work and overlapping jobs", () => {
    const clashA = calendarJob({ id: "a", day: "2026-11-12", startTime: "10:00", dueTime: "12:00" });
    const clashB = calendarJob({ id: "b", day: "2026-11-12", startTime: "11:00", dueTime: "13:00", propertyName: "Manly Loft" });
    const data = calendarResponse([clashA, clashB, unassigned]);
    expect(weekStripDay(data, "2026-11-12")).toEqual({ day: "2026-11-12", jobs: 2, unassigned: 0, clash: true });
    expect(weekStripDay(data, "2026-11-11")).toEqual({ day: "2026-11-11", jobs: 1, unassigned: 1, clash: false });
    expect(weekStripDay(data, "2026-11-20").jobs).toBeNull();
  });

  it("flags leave or roster, a clash, and never calls an unloaded day free", () => {
    const other = calendarJob({ id: "o", day: "2026-11-12", startTime: "09:00", dueTime: "11:00", propertyName: "Manly Loft", cleaners: [{ id: "u2", name: "Aiko T.", isPrimary: true }] });
    const job = calendarJob({ id: "j", day: "2026-11-11", startTime: "10:00", dueTime: "12:00" });
    const data = calendarResponse([other, job]);
    const aiko = data.cleanerRows[1];
    const jane = data.cleanerRows[0];
    expect(cleanerFlag(data, aiko, job, "2026-11-12", "10:00")).toMatchObject({ kind: "clash", text: "Clashes with Manly Loft at 09:00" });
    expect(cleanerFlag(data, aiko, job, "2026-11-12", "11:00").kind).toBe("free");
    expect(cleanerFlag(data, jane, job, "2026-11-15", "10:00").kind).toBe("roster");
    expect(cleanerFlag(data, aiko, job, "2026-11-30", "10:00").kind).toBe("unknown");
  });
});
