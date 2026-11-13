/**
 * Admin phone: Live ops (board "Admin phone: Calendar and Live ops").
 * Every desktop action stays reachable below 640px, and from 640px up the
 * page is unchanged.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/maps/loader", () => ({ ensureGoogleMaps: () => Promise.reject(new Error("no key")) }));
vi.mock("@/components/v2/admin/jobs/job-peek-panel", () => ({ JobPeekPanel: ({ jobId }: { jobId: string | null }) => (jobId ? <p>Peek {jobId}</p> : null) }));

import { LiveFeedProvider } from "@/components/v2/admin/ops/live-feed-provider";
import { LiveOpsWorkspace } from "@/components/v2/admin/ops/live-ops-workspace";
import type { LiveBoardPayload, LiveJobRow } from "@/lib/ops/live-board-types";

class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(public url: string) {}
  close() {}
}

function row(overrides: Partial<LiveJobRow>): LiveJobRow {
  return {
    jobId: "j1", jobNumber: "1", propertyName: "Glebe House", suburb: null, status: "EN_ROUTE", state: "late", startTime: "10:30", dueTime: null,
    sameDayCheckinTime: null, cleaners: [{ id: "u1", name: "Aiko T.", phone: "0400 000 003" }], minutes: 18, etaClock: "10:48",
    distanceMeters: null, elapsedMinutes: null, allocatedMinutes: null, progress: null, openTimeLogId: null,
    field: { address: null, safety: null, checkInDistanceMeters: null, gpsCheckInAt: null },
    ...overrides,
  };
}

const board: LiveBoardPayload = {
  todayKey: "2026-11-11", timeZone: "Australia/Sydney",
  jobs: [
    row({ delayNotice: null }),
    row({ jobId: "j4", propertyName: "Surry Hills 2B", state: "off-site", status: "IN_PROGRESS", minutes: 12, distanceMeters: 420, cleaners: [{ id: "u2", name: "Sam O.", phone: null }], runningClocks: [{ timeLogId: "log-9", userId: "u2", name: "Sam O.", startedAt: "2026-11-11T00:00:00Z" }] }),
    row({ jobId: "j5", propertyName: "Coogee Terrace", state: "on-site", status: "IN_PROGRESS", minutes: null, cleaners: [{ id: "u3", name: "Jane C.", phone: null }],
      cleanerStates: [{ userId: "u3", state: "on-site", liveStatus: "NO_SIGNAL", distanceMeters: null, minutes: null, trackingState: null, lastFixAt: null, startedWithoutFix: true }] }),
  ],
  continuations: [{ id: "c1", jobId: "j3", propertyName: "Coogee Terrace", cleanerName: "Jane C.", reason: "Oven", remainingHours: 2, requestedAt: "x" }],
  drivers: [{ routeId: "r1", userId: "d1", name: "Driver Tom", phone: null, stopsDone: 2, stopsTotal: 6, lat: -33.9, lng: 151.2, lastPingAt: new Date().toISOString() }],
  cleaners: [],
  counts: { exceptions: 3, onSite: 1, travelling: 0, notStarted: 0, cleanersOnShift: 3, driversOnShift: 1 },
  generatedAt: "2026-11-11T00:00:00Z",
};

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/admin/ops/live-locations") return new Response(JSON.stringify({ pings: [{ userId: "u1", user: { name: "Aiko T." }, lat: -33.88, lng: 151.18, timestamp: new Date().toISOString(), positionSource: "gps", liveStatus: "EN_ROUTE", liveLabel: "En route" }] }), { status: 200 });
    if (url === "/api/admin/ops/live-board") return new Response(JSON.stringify(board), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderOps() {
  return render(
    <LiveFeedProvider>
      <LiveOpsWorkspace properties={[]} attention={[{ label: "Open cases", count: 2, href: "/v2/admin/cases?queue=open" }]} initialView="exceptions" todayKey="2026-11-11" timeZone="Australia/Sydney" readOnly={false} canNotifyClient canPauseClock />
    </LiveFeedProvider>,
  );
}

describe("Live ops on a phone", () => {
  beforeEach(() => setPhone(true));

  it("switches between the list and the map as two screens", async () => {
    renderOps();
    await screen.findByText("18 min late");
    const list = screen.getByRole("region", { name: "On shift" });
    const map = screen.getByRole("region", { name: "Map" });
    expect(map.className).toContain("max-sm:hidden");
    expect(list.className).not.toContain("max-sm:hidden");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    expect(list.className).toContain("max-sm:hidden");
    expect(map.className).not.toContain("max-sm:hidden");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(map.className).toContain("max-sm:hidden");
  });

  it("keeps the state chips (real counts) as one swipeable row and every view reachable", async () => {
    renderOps();
    await screen.findByText("18 min late");
    const chips = screen.getByRole("group", { name: "Show" });
    expect(chips.className).toContain("max-sm:overflow-x-auto");
    for (const name of [/Exceptions/, /On site/, /Travelling/, /Not started/]) expect(within(chips).getByRole("button", { name })).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole("button", { name: /On site/ }));
    expect(await screen.findByText("Started without a location fix")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Map layers" }).className).toContain("max-sm:overflow-x-auto");
    for (const name of ["Cleaners", "Laundry drivers", "Properties"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan routes" })).toBeInTheDocument();
  });

  it("keeps each exception's main fix on the card and the rest under More", async () => {
    renderOps();
    await screen.findByText("18 min late");
    const late = screen.getByText("18 min late").closest("li")!;
    expect(within(late).getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:0400000003");
    expect(within(late).getByRole("button", { name: "Tell client" })).toBeInTheDocument();
    expect(within(late).queryByRole("link", { name: "Message" })).toBeNull();
    fireEvent.click(within(late).getByRole("button", { name: /More actions for Aiko T./ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: "Message" })).toHaveAttribute("href", "/v2/admin/jobs/j1?tab=messages");
    fireEvent.click(within(sheet).getByRole("button", { name: "Reassign" }));
    expect(await screen.findByText("Peek j1")).toBeInTheDocument();

    const continuation = screen.getByText("Wants to continue later").closest("li")!;
    expect(within(continuation).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(within(continuation).getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Also needs attention" })).toBeInTheDocument();
    expect(screen.getByText(/Field status: safety and GPS check-ins/)).toBeInTheDocument();

    const off = screen.getByText("Left site, clock running").closest("li")!;
    expect(within(off).getByRole("button", { name: "Pause clock" })).toBeInTheDocument();
    fireEvent.click(within(off).getByRole("button", { name: /More actions for Sam O./ }));
    expect(within(await screen.findByRole("dialog")).getByRole("link", { name: "Review clock" })).toHaveAttribute("href", "/v2/admin/jobs/j4?tab=activity");
  });

  it("opens the map with the person card and its Call, Message and Tell client when a person is chosen", async () => {
    renderOps();
    await screen.findByText("18 min late");
    fireEvent.click(screen.getByRole("button", { name: "Aiko T. · Glebe House" }));
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    const actions = await screen.findByLabelText("Person actions");
    expect(within(actions).getByRole("link", { name: "Call" })).toBeInTheDocument();
    expect(within(actions).getByRole("link", { name: "Message" })).toHaveAttribute("href", "/v2/admin/jobs/j1?tab=messages");
    expect(within(actions).getByRole("link", { name: "Tell client" })).toBeInTheDocument();
  });
});

describe("Live ops from 640px up", () => {
  beforeEach(() => setPhone(false));

  it("is unchanged: no List / Map switch, toggles in place, every row action inline, no More", async () => {
    renderOps();
    await screen.findByText("18 min late");
    expect(screen.queryByRole("group", { name: "Show list or map" })).toBeNull();
    expect(screen.getByRole("region", { name: "Map" }).className).toContain("max-sm:hidden"); // phone-only class, no effect at 640px+
    const late = screen.getByText("18 min late").closest("li")!;
    for (const name of ["Message", "Call"]) expect(within(late).getByRole("link", { name })).toBeInTheDocument();
    expect(within(late).getByRole("button", { name: "Reassign" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /More actions/ })).toBeNull();
    const off = screen.getByText("Left site, clock running").closest("li")!;
    expect(within(off).getByRole("link", { name: "Review clock" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aiko T. · Glebe House" }));
    await waitFor(() => expect(screen.getByLabelText("Close person card")).toBeInTheDocument());
    expect(screen.queryByLabelText("Person actions")).toBeNull();
  });
});
