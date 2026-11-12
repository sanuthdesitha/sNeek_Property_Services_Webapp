import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspace } from "@/components/v2/admin/calendar/calendar-workspace";
import { readCalendarRestore } from "@/components/v2/admin/calendar/use-calendar-state";
import { TOUCH_HOLD_MS } from "@/lib/calendar/touch-drag";
import { readCalendarState, restorableSessionDate } from "@/lib/calendar/url-state";
import { calendarJob, calendarResponse } from "../lib/calendar-fixtures";

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
async function answer(call: Call, body: unknown, status = 200) {
  await act(async () => { call.resolve(body, status); });
}

class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerType = init.pointerType ?? "mouse";
  }
}
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent = TestPointerEvent;
}

function chip(name: string): HTMLElement {
  return screen.getAllByRole("button", { name: new RegExp(name) }).find((element) => element.closest("[data-job-chip]"))!.closest<HTMLElement>("[data-job-chip]")!;
}

const free = calendarJob({ id: "free", propertyName: "Coogee Terrace", cleaners: [], status: "UNASSIGNED", day: "2026-11-12", startTime: "11:30" });
const janes = calendarJob({ id: "jane-job", propertyName: "Bondi Studio", day: "2026-11-11", startTime: "10:00", dueTime: "14:00" });

beforeEach(() => {
  calls = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("touch drag on the calendar", () => {
  beforeEach(() => window.history.replaceState(null, "", "/v2/admin/calendar?view=week&date=2026-11-11"));

  it("press-and-hold lifts the chip, then the drop goes through the same check", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-11T00:00:00.000Z"));
    render(<CalendarWorkspace />);
    await answer(lastCalendar(), calendarResponse([free, janes]));
    expect(chip("Coogee Terrace").querySelector("svg")).not.toBeNull(); // the grip affordance
    const target = document.querySelector('[data-drop-lane="cleaner"][data-drop-row="u2"][data-drop-day="2026-11-13"]')!;
    document.elementFromPoint = vi.fn(() => target);
    fireEvent.pointerDown(chip("Coogee Terrace"), { button: 0, pointerType: "touch", clientX: 10, clientY: 10 });
    await act(async () => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
    expect(screen.getByText(/Moving Coogee Terrace/)).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 200, clientY: 200 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 200, clientY: 200 }));
    });
    expect(callsTo("/api/admin/calendar/check-move")[0].body).toEqual({ jobId: "free", toDate: "2026-11-13", fromCleanerId: null, toCleanerId: "u2" });
  });

  it("a finger that moves before the hold is a scroll: no drag, no check", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    render(<CalendarWorkspace />);
    await answer(lastCalendar(), calendarResponse([free, janes]));
    const target = document.querySelector('[data-drop-lane="cleaner"][data-drop-row="u2"][data-drop-day="2026-11-13"]')!;
    document.elementFromPoint = vi.fn(() => target);
    fireEvent.pointerDown(chip("Coogee Terrace"), { button: 0, pointerType: "touch", clientX: 10, clientY: 10 });
    await act(async () => {
      vi.advanceTimersByTime(100);
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 80 }));
      vi.advanceTimersByTime(TOUCH_HOLD_MS);
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 10, clientY: 80 }));
    });
    expect(screen.queryByText(/Moving Coogee Terrace/)).toBeNull();
    expect(callsTo("/api/admin/calendar/check-move")).toHaveLength(0);
  });
});

describe("Day view drop changes the time", () => {
  it("proposes the snapped start under the pointer (keeping the grab point) and saves it through the reschedule service", async () => {
    window.history.replaceState(null, "", "/v2/admin/calendar?view=day&date=2026-11-11");
    render(<CalendarWorkspace />);
    const day = ["2026-11-11"];
    await answer(lastCalendar(), calendarResponse([janes], { range: { start: day[0], end: day[0], days: day } }));
    const track = document.querySelector<HTMLElement>('[data-drop-lane="cleaner"][data-drop-row="u1"][data-drop-axis-start]')!;
    expect(track.dataset.dropAxisStart).toBe("360");
    document.elementFromPoint = vi.fn(() => track);
    // Track starts at 06:00, 72 px per hour (jsdom rects are at 0): 288 px = 10:00, the chip's start.
    fireEvent.pointerDown(chip("Bondi Studio"), { button: 0, pointerType: "mouse", clientX: 288, clientY: 10 });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 340, clientY: 12 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 340, clientY: 12 }));
    });
    const check = callsTo("/api/admin/calendar/check-move")[0];
    expect(check.body).toEqual({ jobId: "jane-job", toDate: "2026-11-11", fromCleanerId: null, toCleanerId: null, toStartTime: "10:45" });
    await answer(check, {
      jobId: "jane-job", propertyName: "Bondi Studio", fromDate: "2026-11-11", toDate: "2026-11-11", toCleanerName: null, blockers: [], warnings: [],
      time: { fromStart: "10:00", toStart: "10:45", fromDue: "14:00", toDue: "14:45" },
      plan: { reschedule: { date: "2026-11-11", expectedUpdatedAt: "2026-11-01T00:00:00.000Z", startTime: "10:45", dueTime: "14:45" }, assign: null },
    });
    expect(screen.getByRole("heading", { name: "Move Bondi Studio to Wed 11 Nov at 10:45?" })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm move" })); });
    expect(callsTo("/reschedule/")[0].body).toEqual({
      date: "2026-11-11", expectedUpdatedAt: "2026-11-01T00:00:00.000Z", reason: "Moved on the calendar", startTime: "10:45", dueTime: "14:45",
    });
  });
});

describe("Calendar view and date survive a refresh (documented exception)", () => {
  it("restores the saved view always and the date only from this session on the same Sydney day", () => {
    expect(restorableSessionDate({ date: "2026-11-20", savedOn: "2026-11-11" }, "2026-11-11")).toBe("2026-11-20");
    expect(restorableSessionDate({ date: "2026-11-20", savedOn: "2026-11-10" }, "2026-11-11")).toBeNull();
    expect(restorableSessionDate({ date: "garbage", savedOn: "2026-11-11" }, "2026-11-11")).toBeNull();
    const restored = readCalendarState(new URLSearchParams(""), undefined, { view: "month", date: "2026-11-20" });
    expect(restored).toMatchObject({ view: "month", date: "2026-11-20" });
    // An explicit URL still wins.
    expect(readCalendarState(new URLSearchParams("view=day&date=2026-11-12"), undefined, { view: "month", date: "2026-11-20" })).toMatchObject({ view: "day", date: "2026-11-12" });
  });

  it("saves on change, and a refreshed URL without view/date opens where the person was", async () => {
    window.history.replaceState(null, "", "/v2/admin/calendar?view=week&date=2026-11-11");
    const first = render(<CalendarWorkspace />);
    await answer(lastCalendar(), calendarResponse([janes]));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    first.unmount();
    expect(readCalendarRestore(new Date())).toMatchObject({ view: "month", date: "2026-11-16" });

    // A full refresh strips view parameters app-wide.
    window.history.replaceState(null, "", "/v2/admin/calendar");
    render(<CalendarWorkspace />);
    expect(lastCalendar().url).toContain("start=2026-11-01&end=2026-11-30");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("view")).toBe("month");
    expect(params.get("date")).toBe("2026-11-16");
  });

  it("a new visit (no session date) opens on today; Today clears the saved date", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/v2/admin/calendar?view=week&date=2026-11-25");
    render(<CalendarWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(readCalendarRestore().date).toBeNull();
    expect(readCalendarRestore().view).toBe("week");
  });
});
