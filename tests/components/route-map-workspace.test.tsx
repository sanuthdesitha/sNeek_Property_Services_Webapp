/**
 * Route map workspace (board "Route map", 2026-11-17): the list works fully
 * without a Maps key and says the map is not configured; "Nobody on these
 * jobs" comes first with the scorer's suggestion; "Assign…" and "Change
 * cleaner…" open the SHARED assign dialog; more than 12 stops shows a notice
 * and drops none; loading / failed / empty are separate; a late answer for
 * an old date never fills the new one; the phone layout switches List / Map.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteMapDay, RouteMapRoute } from "@/lib/ops/route-map-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/v2/admin/jobs/route-map", useSearchParams: () => null }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/maps/loader", () => ({ resolveBrowserMapsKey: vi.fn(async () => ""), ensureGoogleMaps: vi.fn(async () => undefined) }));

import { RouteMapWorkspace } from "@/components/v2/admin/jobs/route-map/route-map-workspace";
import { buildMapPins } from "@/components/v2/admin/jobs/route-map/route-map-model";
import { RouteStopPin } from "@/components/v2/admin/ops/ops-map-pin-views";

type Pending = { url: string; init: RequestInit; resolve: (body: unknown, status?: number) => void };
let calls: Pending[];

function stop(index: number, overrides: Partial<RouteMapRoute["stops"][number]> = {}): RouteMapRoute["stops"][number] {
  return {
    jobId: `job-${index}`, propertyName: `Stop ${index}`, address: `${index} Test St`, suburb: "Bondi", startTime: `${String(6 + index).padStart(2, "0")}:00`, dueTime: null,
    jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", travelFromPrevious: index === 1 ? 0 : 8, position: { lat: -33.89, lng: 151.27, precision: "property" },
    assigneeIds: ["c-maria"], primaryAssigneeId: "c-maria", mapsHref: `https://www.google.com/maps/search/?api=1&query=${index}`, ...overrides,
  };
}

function day(overrides: Partial<RouteMapDay> = {}): RouteMapDay {
  return {
    date: "2026-11-15",
    groupBySuburb: true,
    suggestionLimit: 8,
    cleaners: [{ id: "c-maria", name: "Maria Santos", email: "maria@x" }, { id: "c-sofia", name: "Sofia Alvarez", email: "sofia@x" }],
    unassigned: [{
      jobId: "job-rose", jobNumber: "J-1", propertyName: "Rose Bay Villa", address: "8 Vickery Ave", suburb: "Rose Bay", jobType: "AIRBNB_TURNOVER",
      startTime: "10:00", dueTime: "13:00", guestCheckinTime: "15:00", position: { lat: -33.87, lng: 151.26, precision: "property" },
      suggestion: { state: "picked", best: { cleanerId: "c-sofia", cleanerName: "Sofia Alvarez", score: 86.2, qaScore: 91.4, suburbHistory: 6, load: 2, maxDailyJobs: 5, availabilityFits: true } },
    }],
    routes: [{
      cleanerId: "c-maria", cleanerName: "Maria Santos", cleanerEmail: "maria@x", letter: "M", lookIndex: 0,
      stops: Array.from({ length: 12 }, (_, index) => stop(index + 1)),
      totalTravelMinutes: 104, stopLimit: 12, hiddenStopCount: 2,
      mapsLinks: [{ label: "stops 1–10", href: "https://www.google.com/maps/dir/?a" }, { label: "stops 10–12", href: "https://www.google.com/maps/dir/?b" }],
      timeIssues: [],
    }],
    ...overrides,
  };
}

function media(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 639") ? phone : false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  calls = [];
  media(false);
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => new Promise((resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    calls.push({ url, init, resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }) });
  })));
});
afterEach(() => vi.unstubAllGlobals());

const routeCalls = () => calls.filter((call) => call.url.startsWith("/api/admin/jobs/route-map"));
async function answer(call: Pending | undefined, body: unknown, status = 200) {
  if (!call) throw new Error("No such call");
  await act(async () => { call.resolve(body, status); });
}

function mount(date = "2026-11-15") {
  return render(<RouteMapWorkspace date={date} today="2026-11-15" tomorrow="2026-11-16" mapConfigured={false} />);
}

describe("route map list without a Maps key", () => {
  it("shows loading, then the shown stops, says the rule hides 2 more, and that the map is not configured", async () => {
    mount();
    expect(screen.getByRole("status", { name: "Loading routes" })).toBeInTheDocument();
    expect(screen.queryByText(/Nobody is assigned/)).not.toBeInTheDocument();
    await answer(routeCalls()[0], day());
    expect(screen.getByRole("heading", { level: 1, name: "Route map" })).toBeInTheDocument();
    expect(screen.getByText("The map is not configured")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Maria Santos" }).closest("[aria-labelledby]") as HTMLElement;
    expect(within(card).getAllByRole("listitem")).toHaveLength(12);
    expect(within(card).getByText("Stop 12")).toBeInTheDocument();
    expect(within(card).getByText(/2 more stops are not shown — the rule ‘Routes: stops shown’ is set to 12/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Settings › Scheduling rules" })).toHaveAttribute("href", "/v2/admin/settings/scheduling-rules");
    expect(within(card).getByRole("link", { name: /stops 10–12/ })).toHaveAttribute("href", "https://www.google.com/maps/dir/?b");
    expect(within(card).getByText("2 more not shown")).toBeInTheDocument();
    // The map key says it too.
    expect(screen.getByText(/Maria Santos: 2 more stops are not on the map/)).toBeInTheDocument();
  });

  it("puts Nobody on these jobs first with the scorer's reasons", async () => {
    mount();
    await answer(routeCalls()[0], day());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings[0]).toBe("Nobody on these jobs");
    expect(screen.getByText("Suggested: Sofia Alvarez")).toBeInTheDocument();
    expect(screen.getByText("QA 91.4")).toBeInTheDocument();
    expect(screen.getByText("Today's load 2/5")).toBeInTheDocument();
    // Nothing was posted just by showing a suggestion.
    expect(calls.filter((call) => call.init.method === "POST")).toEqual([]);
  });

  it("Assign Sofia… opens the shared assign dialog with Sofia ticked; Save posts the existing assign body", async () => {
    mount();
    await answer(routeCalls()[0], day());
    fireEvent.click(screen.getByRole("button", { name: "Assign Sofia…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Assign cleaners")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /Sofia Alvarez/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Maria Santos/ })).not.toBeChecked();
    await answer(calls.find((call) => call.url.includes("/api/admin/jobs/assign-facts")), { jobs: [{ id: "job-rose", dayKey: "2026-11-15" }], cleaners: [] });
    fireEvent.click(within(dialog).getByRole("button", { name: /Assign 1/ }));
    const post = calls.find((call) => call.url === "/api/admin/jobs/job-rose/assign");
    expect(JSON.parse(String(post?.init.body))).toEqual({ userIds: ["c-sofia"], primaryUserId: "c-sofia" });
    await answer(post, { ok: true });
    // The day is read again after a save.
    await waitFor(() => expect(routeCalls()).toHaveLength(2));
  });

  it("Choose… opens the same dialog with nobody ticked; Change cleaner… starts from the current cleaners", async () => {
    mount();
    await answer(routeCalls()[0], day());
    fireEvent.click(screen.getByRole("button", { name: "Choose a cleaner for Rose Bay Villa" }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /Sofia Alvarez/ })).not.toBeChecked();
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Stop 3" }));
    // The selected stop's card sits with the map (here: the not-configured panel).
    fireEvent.click(screen.getByRole("button", { name: "Change cleaner…" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /Maria Santos/ })).toBeChecked();
  });
});

describe("states", () => {
  it("a failed read says so and offers Try again, never an empty day", async () => {
    mount();
    await answer(routeCalls()[0], { error: "boom" }, 500);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText(/Nobody is assigned/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await answer(routeCalls()[1], day());
    expect(screen.getByRole("heading", { name: "Maria Santos" })).toBeInTheDocument();
  });

  it("an empty day says nobody is assigned and still lists jobs with nobody on them", async () => {
    mount();
    await answer(routeCalls()[0], day({ routes: [] }));
    expect(screen.getByText(/Nobody is assigned to a job on/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nobody on these jobs" })).toBeInTheDocument();
  });

  it("changing the date aborts the old read and a late answer never fills the new day", async () => {
    const view = mount("2026-11-15");
    const first = routeCalls()[0];
    view.rerender(<RouteMapWorkspace date="2026-11-16" today="2026-11-15" tomorrow="2026-11-16" mapConfigured={false} />);
    expect(first.init.signal?.aborted).toBe(true);
    await answer(first, day());
    expect(screen.queryByRole("heading", { name: "Maria Santos" })).not.toBeInTheDocument();
    await answer(routeCalls()[1], day({ date: "2026-11-16", routes: [] }));
    expect(screen.getByText(/Nobody is assigned to a job on Mon 16 Nov 2026/)).toBeInTheDocument();
  });

  it("says a grouped-by-suburb route is out of time order, as information with a link to the rule", async () => {
    const base = day();
    const two = [{ ...base.routes[0].stops[0], propertyName: "Darlinghurst Terrace", startTime: "13:00" }, { ...base.routes[0].stops[1], propertyName: "Surry Hills Studio", startTime: "10:00" }];
    const route = { ...base.routes[0], stops: two, hiddenStopCount: 0, timeIssues: [{ kind: "out_of_order" as const, stopIndex: 1, earlierIndex: 0 }], mapsLinks: [{ label: "stops 1–2", href: "https://www.google.com/maps/dir/?c" }] };
    mount();
    await answer(routeCalls()[0], { ...base, routes: [route] });
    expect(screen.getByText("Out of time order")).toBeInTheDocument();
    expect(screen.getByText(/Grouped by suburb: a 10:00 stop comes after a 13:00 stop/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Maria Santos's route in Google Maps, 2 stops" })).toHaveTextContent("Open route in Google Maps (2 stops)");
  });

  it("flags a route whose times overlap", async () => {
    const base = day();
    const route = { ...base.routes[0], stops: base.routes[0].stops.slice(0, 2), timeIssues: [{ kind: "overlap" as const, stopIndex: 1, earlierIndex: 0 }], mapsLinks: base.routes[0].mapsLinks.slice(0, 1) };
    route.stops[0] = { ...route.stops[0], dueTime: "09:00" };
    mount();
    await answer(routeCalls()[0], { ...base, routes: [route] });
    expect(screen.getByText("Times overlap")).toBeInTheDocument();
    expect(screen.getByText(/before Stop 1 is due to finish at 09:00/)).toBeInTheDocument();
  });
});

describe("phone layout", () => {
  it("has a List / Map switch and docks the next assignment, which opens the shared dialog", async () => {
    media(true);
    mount();
    await answer(routeCalls()[0], day());
    const list = screen.getByRole("button", { name: "List" });
    expect(list).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    const bar = screen.getByRole("region", { name: "Route map actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "Assign Sofia to Rose Bay Villa…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /Sofia Alvarez/ })).toBeChecked();
  });
});

describe("phone stop sheet", () => {
  it("tapping a stop opens its actions in a bottom sheet", async () => {
    media(true);
    mount();
    await answer(routeCalls()[0], day());
    fireEvent.click(screen.getByRole("button", { name: "Stop 2" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("M2 · Stop 2")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Open job" })).toHaveAttribute("href", "/v2/admin/jobs/job-2");
    expect(within(sheet).getByRole("button", { name: "Change cleaner…" })).toBeInTheDocument();
  });
});

describe("pins", () => {
  it("carry the cleaner's letter and stop number, '?' for nobody, and say a suburb-centre position", () => {
    const base = day();
    base.routes[0].stops[1] = { ...base.routes[0].stops[1], position: { lat: -33.9, lng: 151.2, precision: "suburb" } };
    base.routes[0].stops[2] = { ...base.routes[0].stops[2], position: null };
    const pins = buildMapPins(base, { search: "", show: "all" });
    expect(pins.map((pin) => pin.look.text).slice(0, 4)).toEqual(["?", "M1", "M2", "M4"]);
    expect(pins[2].look.atSuburb).toBe(true);
    expect(pins[2].ariaLabel).toMatch(/suburb centre/);
    expect(buildMapPins(base, { search: "", show: "nobody" }).map((pin) => pin.look.text)).toEqual(["?"]);
    const onActivate = vi.fn();
    render(<RouteStopPin look={pins[1].look} ariaLabel={pins[1].ariaLabel} onActivate={onActivate} />);
    const button = screen.getByRole("button", { name: /M1: Maria Santos, stop 1 of 12/ });
    expect(button).toHaveAttribute("data-pin-text", "M1");
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalled();
  });
});
