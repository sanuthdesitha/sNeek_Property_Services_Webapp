import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarWorkspace } from "@/components/v2/admin/calendar/calendar-workspace";
import { calendarJob, calendarResponse } from "../lib/calendar-fixtures";
import type { CalendarResponse } from "@/lib/calendar/types";

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

const unassigned = calendarJob({ id: "free", propertyName: "Coogee Terrace", cleaners: [], status: "UNASSIGNED", day: "2026-11-12", startTime: "11:30" });
const janes = calendarJob({ id: "jane-job", propertyName: "Bondi Studio", day: "2026-11-11", guestArrival: { time: "15:00" } });
const started = calendarJob({ id: "started", propertyName: "Glebe House", status: "IN_PROGRESS", day: "2026-11-10", moveBlock: "Work on this job has started. It cannot be moved from the calendar; use the job's Schedule tab if a correction is needed." });
const week = (): CalendarResponse => calendarResponse([unassigned, janes, started]);

const checkResult = (overrides: Record<string, unknown> = {}) => ({
  jobId: "jane-job", propertyName: "Bondi Studio", fromDate: "2026-11-11", toDate: "2026-11-13", toCleanerName: null, blockers: [],
  warnings: [{ kind: "clash", text: "Jane C.: Clashes with Manly Loft until 13:00" }],
  plan: { reschedule: { date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, assign: null },
  ...overrides,
});

beforeEach(() => {
  calls = [];
  window.history.replaceState(null, "", "/v2/admin/calendar?view=week&date=2026-11-11");
  window.localStorage.clear();
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
afterEach(() => vi.unstubAllGlobals());

// jsdom has no PointerEvent; the drag reads `button` and `pointerType` from it.
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

async function renderWeek(data: CalendarResponse = week()) {
  render(<CalendarWorkspace />);
  await answer(lastCalendar(), data);
}

function chip(name: string): HTMLElement {
  return screen.getAllByRole("button", { name: new RegExp(name) }).find((element) => element.closest("[data-job-chip]"))!.closest<HTMLElement>("[data-job-chip]")!;
}

async function openMenuItem(name: string, item: string) {
  const menuButton = within(chip(name)).getByRole("button", { name: `Actions for ${name}` });
  await act(async () => { fireEvent.click(menuButton); });
  await act(async () => { fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(item) })); });
}

describe("Calendar workspace", () => {
  it("asks only for the visible week, in the URL's filters", async () => {
    window.history.replaceState(null, "", "/v2/admin/calendar?view=week&date=2026-11-11&status=done&clientId=c9&laundry=0");
    render(<CalendarWorkspace />);
    expect(lastCalendar().url).toBe("/api/admin/calendar?start=2026-11-09&end=2026-11-15&rows=cleaners&status=SUBMITTED%2CQA_REVIEW%2CCOMPLETED%2CINVOICED&clientId=c9");
    expect(callsTo("/api/jobs")).toHaveLength(0);
  });

  it("shows an error, not an empty calendar, when the read fails, and retries", async () => {
    render(<CalendarWorkspace />);
    await answer(lastCalendar(), { error: "Database unavailable" }, 500);
    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText("31 h this week")).toBeNull();
    expect(screen.getByText(/could not be loaded/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await answer(lastCalendar(), week());
    expect(screen.getByText("Week of 9 November · 3 jobs · 1 without a cleaner")).toBeVisible();
  });

  it("draws the resource grid: Unassigned lane, cleaner hours, roster gap, guest arrival, written status", async () => {
    await renderWeek();
    expect(screen.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
    expect(screen.getByText("31 h this week")).toBeVisible();
    expect(screen.getByText("Not rostered")).toBeVisible();
    expect(screen.getByText("Wed 11 · today")).toBeVisible();
    expect(within(chip("Bondi Studio")).getByText("Guest in 15:00")).toBeVisible();
    expect(within(chip("Glebe House")).getByText("· on site")).toBeVisible();
    expect(within(chip("Coogee Terrace")).getByText("· no cleaner")).toBeVisible();
  });

  it("opens the shared job peek panel from a chip", async () => {
    await renderWeek();
    fireEvent.click(within(chip("Bondi Studio")).getAllByRole("button")[0]);
    expect(new URLSearchParams(window.location.search).get("open")).toBe("jane-job");
    expect(callsTo("/api/admin/jobs/jane-job/peek")).toHaveLength(1);
  });

  it("says why a started job cannot move, and offers no move", async () => {
    await renderWeek();
    const main = within(chip("Glebe House")).getAllByRole("button")[0];
    expect(main).toHaveAttribute("title", expect.stringMatching(/Work on this job has started/));
    await act(async () => { fireEvent.click(within(chip("Glebe House")).getByRole("button", { name: "Actions for Glebe House" })); });
    expect(await screen.findByRole("menuitem", { name: /Move or reassign/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("keyboard move: dialog → server check → confirm → the reschedule endpoint only", async () => {
    await renderWeek();
    await openMenuItem("Bondi Studio", "Move or reassign");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check move" })); });
    const checkCall = callsTo("/api/admin/calendar/check-move")[0];
    expect(checkCall.body).toEqual({ jobId: "jane-job", toDate: "2026-11-13", fromCleanerId: null, toCleanerId: null });
    await answer(checkCall, checkResult());
    expect(screen.getByRole("heading", { name: "Move Bondi Studio to Fri 13 Nov?" })).toBeVisible();
    expect(screen.getByText(/Clashes with Manly Loft/)).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm move" })); });
    const reschedule = callsTo("/reschedule/")[0];
    expect(reschedule.url).toBe("/api/admin/phase4/reschedule/jane-job/apply");
    expect(reschedule.body).toEqual({ date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z", reason: "Moved on the calendar" });
    await answer(reschedule, { id: "jane-job" });
    expect(posts()).toEqual(["/api/admin/calendar/check-move", "/api/admin/phase4/reschedule/jane-job/apply"]);
    // The calendar is read again for the saved state.
    expect(callsTo("/api/admin/calendar?").length).toBe(2);
  });

  it("a drop from Unassigned onto a cleaner checks, then calls reschedule and assign as planned and nothing else", async () => {
    await renderWeek();
    const target = document.querySelector('[data-drop-lane="cleaner"][data-drop-row="u2"][data-drop-day="2026-11-13"]')!;
    document.elementFromPoint = vi.fn(() => target);
    const source = chip("Coogee Terrace");
    fireEvent.pointerDown(source, { button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 60, clientY: 60 }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX: 60, clientY: 60 }));
    });
    const checkCall = callsTo("/api/admin/calendar/check-move")[0];
    expect(checkCall.body).toEqual({ jobId: "free", toDate: "2026-11-13", fromCleanerId: null, toCleanerId: "u2" });
    await answer(checkCall, checkResult({
      jobId: "free", propertyName: "Coogee Terrace", fromDate: "2026-11-12", toCleanerName: "Aiko T.", warnings: [],
      plan: { reschedule: { date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, assign: { userIds: ["u2"], primaryUserId: "u2" } },
    }));
    expect(screen.getByRole("heading", { name: "Move Coogee Terrace to Fri 13 Nov, Aiko T.?" })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm move" })); });
    await answer(callsTo("/reschedule/")[0], { id: "free" });
    const assignCall = callsTo("/api/admin/jobs/free/assign")[0];
    expect(assignCall.body).toEqual({ userIds: ["u2"], primaryUserId: "u2" });
    await answer(assignCall, { ok: true });
    expect(posts()).toEqual(["/api/admin/calendar/check-move", "/api/admin/phase4/reschedule/free/apply", "/api/admin/jobs/free/assign"]);
  });

  it("a refused move leaves the chip in place and shows the server's reason", async () => {
    await renderWeek();
    await openMenuItem("Bondi Studio", "Move or reassign");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check move" })); });
    await answer(callsTo("/check-move")[0], checkResult({ blockers: ["Enter a valid start and finish window. Fix the job's times on its Schedule tab first."] }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid start and finish window.");
    expect(posts()).toEqual(["/api/admin/calendar/check-move"]);
    expect(chip("Bondi Studio").closest("[data-drop-day]")).toHaveAttribute("data-drop-day", "2026-11-11");
  });

  it("a failed save keeps the message and the chip where it was", async () => {
    await renderWeek();
    await openMenuItem("Bondi Studio", "Move or reassign");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check move" })); });
    await answer(callsTo("/check-move")[0], checkResult());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm move" })); });
    await answer(callsTo("/reschedule/")[0], { error: "This job changed. Reload before rescheduling." }, 400);
    expect(screen.getByRole("alert")).toHaveTextContent("Not moved: This job changed. Reload before rescheduling.");
    expect(chip("Bondi Studio").closest("[data-drop-day]")).toHaveAttribute("data-drop-day", "2026-11-11");
  });

  it("a background refresh during a save does not redraw the chip being saved", async () => {
    await renderWeek();
    await openMenuItem("Bondi Studio", "Move or reassign");
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-13" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check move" })); });
    await answer(callsTo("/check-move")[0], checkResult());
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm move" })); });
    // Saving: a focus refresh lands with the job (and another) moved elsewhere.
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await answer(lastCalendar(), calendarResponse([
      { ...janes, day: "2026-11-14" },
      { ...unassigned, day: "2026-11-15" },
      started,
    ]));
    expect(chip("Bondi Studio").closest("[data-drop-day]")).toHaveAttribute("data-drop-day", "2026-11-11");
    expect(within(chip("Bondi Studio")).getByText("Move pending…")).toBeVisible();
    expect(chip("Coogee Terrace").closest("[data-drop-day]")).toHaveAttribute("data-drop-day", "2026-11-15");
  });

  it("“+N more” in Month opens that day in Day view", async () => {
    window.history.replaceState(null, "", "/v2/admin/calendar?view=month&date=2026-11-11");
    render(<CalendarWorkspace />);
    expect(lastCalendar().url).toContain("start=2026-11-01&end=2026-11-30");
    const busy = ["a", "b", "c", "d"].map((id, index) => calendarJob({ id, propertyName: `Home ${id}`, day: "2026-11-18", startTime: `0${index + 6}:00` }));
    const days = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`);
    await answer(lastCalendar(), calendarResponse(busy, { range: { start: days[0], end: days[29], days } }));
    fireEvent.click(screen.getAllByRole("button", { name: "+1 more" })[0]);
    const params = new URLSearchParams(window.location.search);
    expect(params.get("view")).toBe("day");
    expect(params.get("date")).toBe("2026-11-18");
    expect(lastCalendar().url).toContain("start=2026-11-18&end=2026-11-18");
  });

  it("keeps view, step and toggles in the URL and saves the toggles as preferences", async () => {
    await renderWeek();
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(new URLSearchParams(window.location.search).get("date")).toBe("2026-11-16");
    expect(lastCalendar().url).toContain("start=2026-11-16&end=2026-11-22");
    fireEvent.click(screen.getByRole("button", { name: "Show laundry runs" }));
    expect(new URLSearchParams(window.location.search).get("laundry")).toBe("0");
    expect(JSON.parse(window.localStorage.getItem(Object.keys(window.localStorage).find((key) => key.startsWith("sneek:calendar-prefs"))!)!)).toMatchObject({ laundry: false });
    fireEvent.click(screen.getByRole("button", { name: "Rows: properties" }));
    expect(new URLSearchParams(window.location.search).get("rows")).toBe("properties");
  });
});
