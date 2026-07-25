import { describe, it, expect } from "vitest";

import { agendaStartDay } from "@/lib/calendar/agenda-window";

describe("agendaStartDay", () => {
  it("returns today's day-of-month mid-month when the cursor is the current month", () => {
    expect(agendaStartDay({ year: 2026, month: 6 }, "2026-07-15")).toBe(15);
  });

  it("returns 1 when today is the first of the cursor month", () => {
    expect(agendaStartDay({ year: 2026, month: 6 }, "2026-07-01")).toBe(1);
  });

  it("returns the last day when today is the last of the cursor month", () => {
    expect(agendaStartDay({ year: 2026, month: 6 }, "2026-07-31")).toBe(31);
  });

  it("returns 1 for a past month", () => {
    expect(agendaStartDay({ year: 2026, month: 5 }, "2026-07-15")).toBe(1);
  });

  it("returns 1 for a future month", () => {
    expect(agendaStartDay({ year: 2026, month: 7 }, "2026-07-15")).toBe(1);
  });

  it("does not confuse the same month in a different year", () => {
    expect(agendaStartDay({ year: 2025, month: 6 }, "2026-07-15")).toBe(1);
  });

  it("handles the Dec/Jan year boundary", () => {
    // Today is 31 Dec 2026; cursor on Dec 2026 starts at 31 …
    expect(agendaStartDay({ year: 2026, month: 11 }, "2026-12-31")).toBe(31);
    // … cursor on Jan 2027 (next month, next year) shows the full month.
    expect(agendaStartDay({ year: 2027, month: 0 }, "2026-12-31")).toBe(1);
    // Today is 1 Jan 2027; December 2026 is now a past month.
    expect(agendaStartDay({ year: 2026, month: 11 }, "2027-01-01")).toBe(1);
    expect(agendaStartDay({ year: 2027, month: 0 }, "2027-01-01")).toBe(1);
  });
});
