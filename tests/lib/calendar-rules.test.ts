import { describe, expect, it } from "vitest";
import {
  CalendarRangeError,
  MAX_CALENDAR_SPAN_DAYS,
  monthGridCells,
  parseCalendarRange,
  rangeHeading,
  shiftCursor,
  utcDateToDayKey,
  viewRange,
} from "@/lib/calendar/range";
import { chipCategory, guestArrivalOnDay, isJobLate, jobScheduledHours, formatHours } from "@/lib/calendar/presentation";
import { calendarMoveBlock } from "@/lib/calendar/move-rules";
import { buildRows } from "@/lib/calendar/rows";
import { resolveDrop } from "@/lib/calendar/drop";
import { mergePreservingPending } from "@/lib/calendar/merge";
import { layoutDayRow } from "@/lib/calendar/day-axis";
import { calendarApiQuery, readCalendarState, writeCalendarState, DEFAULT_CALENDAR_PREFS } from "@/lib/calendar/url-state";
import type { CalendarJob, CalendarResponse } from "@/lib/calendar/types";
import { calendarJob } from "./calendar-fixtures";

describe("calendar ranges", () => {
  it("accepts up to 45 days and refuses more, reversed or malformed ranges", () => {
    expect(parseCalendarRange("2026-11-01", "2026-12-15")).toEqual({ start: "2026-11-01", end: "2026-12-15" });
    expect(() => parseCalendarRange("2026-11-01", "2026-12-16")).toThrow(CalendarRangeError);
    expect(() => parseCalendarRange("2026-11-10", "2026-11-09")).toThrow(/before/);
    expect(() => parseCalendarRange("2026-02-30", "2026-03-01")).toThrow(/YYYY-MM-DD/);
    expect(() => parseCalendarRange(null, "2026-03-01")).toThrow(CalendarRangeError);
    expect(MAX_CALENDAR_SPAN_DAYS).toBe(45);
  });

  it("computes each view's days, Monday-first weeks and steps", () => {
    expect(viewRange("week", "2026-11-11")).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(viewRange("day", "2026-11-11")).toEqual({ start: "2026-11-11", end: "2026-11-11" });
    expect(viewRange("month", "2026-11-11")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(viewRange("agenda", "2026-11-11")).toEqual({ start: "2026-11-11", end: "2026-11-24" });
    expect(shiftCursor("week", "2026-11-11", 1)).toBe("2026-11-16");
    expect(shiftCursor("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftCursor("agenda", "2026-11-11", -1)).toBe("2026-10-28");
    expect(monthGridCells("2026-11-11").slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
  });

  it("keeps calendar days unshifted across the Sydney daylight-saving change", () => {
    // Sydney daylight saving began on Sunday 4 October 2026.
    expect(utcDateToDayKey(new Date("2026-10-04T00:00:00.000Z"))).toBe("2026-10-04");
    expect(viewRange("week", "2026-10-04")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(viewRange("week", "2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("states the range in the header the way the agenda lists it", () => {
    expect(rangeHeading("week", "2026-11-11")).toBe("Week of 9 November");
    expect(rangeHeading("agenda", "2026-11-11")).toBe("11 – 24 November");
    expect(rangeHeading("agenda", "2026-11-25")).toBe("25 Nov – 8 Dec");
  });
});

describe("calendar presentation", () => {
  it("counts estimated hours first, then the start-to-finish window, else unknown", () => {
    expect(jobScheduledHours({ estimatedHours: 2.5, startTime: "10:00", endTime: null, dueTime: "15:00" })).toBe(2.5);
    expect(jobScheduledHours({ estimatedHours: null, startTime: "10:00", endTime: null, dueTime: "13:30" })).toBe(3.5);
    expect(jobScheduledHours({ estimatedHours: null, startTime: "10:00", endTime: null, dueTime: null })).toBeNull();
    expect(formatHours(31)).toBe("31 h");
    expect(formatHours(7.25)).toBe("7.3 h");
  });

  it("marks a pre-start job late only once its Sydney start time has passed", () => {
    const now = new Date("2026-11-11T00:30:00.000Z"); // 11:30 in Sydney (AEDT)
    const job = { status: "ASSIGNED", day: "2026-11-11", startTime: "10:00", hasCleaner: true, skipped: false };
    expect(isJobLate(job, now)).toBe(true);
    expect(isJobLate({ ...job, startTime: "12:00" }, now)).toBe(false);
    expect(isJobLate({ ...job, status: "IN_PROGRESS" }, now)).toBe(false);
    expect(isJobLate({ ...job, hasCleaner: false }, now)).toBe(false);
    expect(isJobLate({ ...job, day: "2026-11-10", startTime: null }, now)).toBe(true);
  });

  it("shows a guest arrival only on the day the arriving stay checks in", () => {
    const base = { day: "2026-11-12", sameDayCheckin: false, sameDayCheckinTime: "15:00", manuallyRescheduled: false };
    expect(guestArrivalOnDay({ ...base, reservationContext: { checkinAtLocal: "2026-11-12T04:00:00.000Z" } })).toEqual({ time: "15:00" });
    expect(guestArrivalOnDay({ ...base, reservationContext: { checkinAtLocal: "2026-11-13T04:00:00.000Z" } })).toBeNull();
    expect(guestArrivalOnDay({ ...base, reservationContext: { stayStartDate: "2026-11-12" } })).toEqual({ time: "15:00" });
    expect(guestArrivalOnDay({ ...base, reservationContext: { stayStartDate: "2026-11-12", preparationSource: "PROPERTY_MAX" } })).toBeNull();
    expect(guestArrivalOnDay({ ...base, reservationContext: undefined, sameDayCheckin: true })).toEqual({ time: "15:00" });
    // After a manual move the stored flag describes the old date, so it is not shown.
    expect(guestArrivalOnDay({ ...base, reservationContext: undefined, sameDayCheckin: true, manuallyRescheduled: true })).toBeNull();
  });

  it("names every chip category", () => {
    expect(chipCategory(calendarJob({ status: "COMPLETED" }))).toBe("done");
    expect(chipCategory(calendarJob({ status: "IN_PROGRESS" }))).toBe("onSite");
    expect(chipCategory(calendarJob({ cleaners: [], status: "UNASSIGNED" }))).toBe("unassigned");
    expect(chipCategory(calendarJob({ late: true }))).toBe("late");
    expect(chipCategory(calendarJob({ status: "OFFERED" }))).toBe("offered");
    expect(chipCategory(calendarJob())).toBe("planned");
    expect(chipCategory(calendarJob({ skipped: true }))).toBe("skipped");
  });

  it("does not offer moves for started, finished, skipped or draft work", () => {
    for (const status of ["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]) {
      expect(calendarMoveBlock({ status, skipped: false, isDraft: false })).toMatch(/cannot be moved from the calendar/);
    }
    expect(calendarMoveBlock({ status: "ASSIGNED", skipped: true, isDraft: false })).toMatch(/skipped/);
    expect(calendarMoveBlock({ status: "UNASSIGNED", skipped: false, isDraft: true })).toMatch(/draft/);
    expect(calendarMoveBlock({ status: "OFFERED", skipped: false, isDraft: false })).toBeNull();
  });
});

describe("calendar rows", () => {
  const jobs = [
    calendarJob({ id: "a", hours: 4 }),
    calendarJob({ id: "b", hours: null, cleaners: [{ id: "u1", name: "Jane C.", isPrimary: true }, { id: "u2", name: "Marco R.", isPrimary: false }] }),
    calendarJob({ id: "c", hours: 3, skipped: true }),
    calendarJob({ id: "d", hours: 2, propertyId: "p2", cleaners: [{ id: "u2", name: "Marco R.", isPrimary: true }] }),
  ];

  it("sums hours per cleaner (in full for each cleaner), skips skipped cleans and counts unknown hours", () => {
    const rows = buildRows([
      { id: "u2", label: "Marco R.", active: true, unavailable: {} },
      { id: "u1", label: "Jane C.", active: true, unavailable: {} },
      { id: "u3", label: "Old", active: false, unavailable: {} },
    ], jobs, "cleaner");
    expect(rows.map((row) => [row.label, row.hours, row.jobsWithoutHours])).toEqual([["Jane C.", 4, 1], ["Marco R.", 2, 1], ["Old", 0, 0]]);
  });

  it("builds property rows", () => {
    const rows = buildRows([{ id: "p2", label: "Coogee", active: true, unavailable: {} }, { id: "p1", label: "Bondi Studio", active: true, unavailable: {} }], jobs, "property");
    expect(rows.map((row) => [row.label, row.hours])).toEqual([["Bondi Studio", 4], ["Coogee", 2]]);
  });
});

describe("drops", () => {
  it("turns drops into day and cleaner changes, and refuses the ones that make no sense", () => {
    expect(resolveDrop({ lane: "unassigned", rowId: null, day: "2026-11-11" }, { lane: "cleaner", rowId: "u1", day: "2026-11-13" }))
      .toEqual({ kind: "move", toDate: "2026-11-13", fromCleanerId: null, toCleanerId: "u1" });
    expect(resolveDrop({ lane: "cleaner", rowId: "u1", day: "2026-11-11" }, { lane: "cleaner", rowId: "u2", day: "2026-11-11" }))
      .toEqual({ kind: "move", toDate: "2026-11-11", fromCleanerId: "u1", toCleanerId: "u2" });
    expect(resolveDrop({ lane: "cleaner", rowId: "u1", day: "2026-11-11" }, { lane: "cleaner", rowId: "u1", day: "2026-11-12" }))
      .toEqual({ kind: "move", toDate: "2026-11-12", fromCleanerId: null, toCleanerId: null });
    expect(resolveDrop({ lane: "cleaner", rowId: "u1", day: "2026-11-11" }, { lane: "cleaner", rowId: "u1", day: "2026-11-11" })).toEqual({ kind: "none" });
    expect(resolveDrop({ lane: "cleaner", rowId: "u1", day: "2026-11-11" }, { lane: "unassigned", rowId: null, day: "2026-11-12" }).kind).toBe("ignored");
    expect(resolveDrop({ lane: "property", rowId: "p1", day: "2026-11-11" }, { lane: "property", rowId: "p2", day: "2026-11-12" }).kind).toBe("ignored");
  });
});

describe("refresh merge", () => {
  const response = (jobs: CalendarJob[]): CalendarResponse => ({
    range: { start: "2026-11-09", end: "2026-11-15", days: [] }, today: "2026-11-11", generatedAt: "", rowsMode: "cleaners",
    cleanerRows: [], propertyRows: [], jobs, laundry: null,
    summary: { jobs: jobs.length, withoutCleaner: 0, skipped: 0, statusCounts: {}, unassignedTotal: 0 }, hoursBasis: "", truncated: false,
  });

  it("never redraws a chip whose move is pending", () => {
    const before = response([calendarJob({ id: "a", day: "2026-11-11" }), calendarJob({ id: "b", day: "2026-11-11" })]);
    const after = response([calendarJob({ id: "a", day: "2026-11-13" }), calendarJob({ id: "b", day: "2026-11-14" })]);
    const merged = mergePreservingPending(before, after, new Set(["a"]));
    expect(merged.jobs.find((job) => job.id === "a")?.day).toBe("2026-11-11");
    expect(merged.jobs.find((job) => job.id === "b")?.day).toBe("2026-11-14");
    expect(mergePreservingPending(before, response([]), new Set(["a"])).jobs.map((job) => job.id)).toEqual(["a"]);
  });
});

describe("day axis", () => {
  it("places timed jobs in separate slots when they overlap and lists untimed ones apart", () => {
    const layout = layoutDayRow([
      calendarJob({ id: "a", startTime: "09:00", dueTime: "12:00" }),
      calendarJob({ id: "b", startTime: "10:00", dueTime: null, estimatedHours: null }),
      calendarJob({ id: "c", startTime: null }),
    ]);
    expect(layout.untimed.map((job) => job.id)).toEqual(["c"]);
    expect(layout.placed.map((item) => [item.job.id, item.slot, item.openEnded])).toEqual([["a", 0, false], ["b", 1, true]]);
  });
});

describe("URL state", () => {
  it("round-trips view, date, rows, filters and toggles and keeps unrelated parameters", () => {
    const state = { view: "day" as const, date: "2026-11-13", rows: "properties" as const, clientId: "c1", status: "done", unassigned: true, laundry: false, arrivals: true };
    const params = writeCalendarState(new URLSearchParams("open=j1"), state);
    expect(params.get("open")).toBe("j1");
    expect(readCalendarState(params)).toEqual(state);
    expect(readCalendarState(new URLSearchParams("status=COMPLETED")).status).toBe("COMPLETED");
    expect(readCalendarState(new URLSearchParams("status=bogus&view=year&date=2026-13-01"))).toMatchObject({ status: "all", view: null, date: null });
  });

  it("falls back to saved preferences when the URL is silent", () => {
    const state = readCalendarState(new URLSearchParams(""), { ...DEFAULT_CALENDAR_PREFS, laundry: false, unassigned: true, rows: "properties" });
    expect(state).toMatchObject({ laundry: false, unassigned: true, rows: "properties" });
    expect(calendarApiQuery({ start: "2026-11-09", end: "2026-11-15" }, { ...state, status: "planned" }))
      .toBe("start=2026-11-09&end=2026-11-15&rows=properties&status=ASSIGNED%2CEN_ROUTE&unassigned=1");
  });
});

describe("operations-manager permission", () => {
  it("puts the calendar endpoints under the Calendar permission, like the page", async () => {
    const { opsRequestFeature } = await import("@/lib/rbac/ops-catalog");
    expect(opsRequestFeature("/api/admin/calendar?start=2026-11-09&end=2026-11-15")).toBe("calendar");
    expect(opsRequestFeature("/api/admin/calendar/check-move")).toBe("calendar");
    expect(opsRequestFeature("/v2/admin/calendar")).toBe("calendar");
  });
});
