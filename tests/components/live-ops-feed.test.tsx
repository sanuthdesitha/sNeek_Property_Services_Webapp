import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/maps/loader", () => ({ ensureGoogleMaps: () => Promise.reject(new Error("no key")) }));
vi.mock("@/components/v2/admin/jobs/job-peek-panel", () => ({
  JobPeekPanel: ({ jobId }: { jobId: string | null }) => (jobId ? <div role="dialog" aria-label="Job preview">{jobId}</div> : null),
}));

import { LiveFeedProvider } from "@/components/v2/admin/ops/live-feed-provider";
import { LiveOpsWorkspace } from "@/components/v2/admin/ops/live-ops-workspace";
import type { LiveBoardPayload, LiveJobRow } from "@/lib/ops/live-board-types";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
}

function row(overrides: Partial<LiveJobRow>): LiveJobRow {
  return {
    jobId: "j1", jobNumber: "1", propertyName: "Glebe House", suburb: null, status: "EN_ROUTE", state: "late", startTime: "10:30", dueTime: null,
    sameDayCheckinTime: "15:00", cleaners: [{ id: "u1", name: "Aiko T.", phone: "0400 000 003" }], minutes: 18, etaClock: "10:48",
    distanceMeters: null, elapsedMinutes: null, allocatedMinutes: null, progress: null, openTimeLogId: null,
    field: { address: null, safety: null, checkInDistanceMeters: null, gpsCheckInAt: null },
    ...overrides,
  };
}

const BOARD: LiveBoardPayload = {
  todayKey: "2026-11-11", timeZone: "Australia/Sydney",
  jobs: [
    row({}),
    row({ jobId: "j2", propertyName: "Manly Loft", state: "on-site", status: "IN_PROGRESS", cleaners: [{ id: "u2", name: "Marco R.", phone: null }], minutes: null, etaClock: null, elapsedMinutes: 70, allocatedMinutes: 180, progress: { percent: 40, basis: "checklist" } }),
  ],
  continuations: [{ id: "c1", jobId: "j3", propertyName: "Coogee Terrace", cleanerName: "Jane C.", reason: "Oven not finished", remainingHours: 2, requestedAt: "x" }],
  drivers: [],
  cleaners: [{ userId: "u1", nextJob: { jobId: "j9", propertyName: "Manly Loft", startTime: "13:00" }, phone: "0400 000 003" }],
  counts: { exceptions: 14, onSite: 1, travelling: 0, notStarted: 9, cleanersOnShift: 2, driversOnShift: 0 },
  generatedAt: "2026-11-11T00:00:00Z",
};

let fetchMock: ReturnType<typeof vi.fn>;
let continuationResponse: () => Response;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  continuationResponse = () => new Response(JSON.stringify({ id: "c1", status: "APPROVED" }), { status: 200 });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/ops/live-locations") return new Response(JSON.stringify({ pings: [] }), { status: 200 });
    if (url === "/api/admin/ops/live-board") return new Response(JSON.stringify(BOARD), { status: 200 });
    if (url.startsWith("/api/admin/job-continuations/") && init?.method === "PATCH") return continuationResponse();
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWorkspace() {
  return render(
    <LiveFeedProvider>
      <LiveOpsWorkspace properties={[]} attention={[{ label: "New leads", count: 3, href: "/v2/admin#work-queue" }]} initialView="exceptions" todayKey="2026-11-11" timeZone="Australia/Sydney" readOnly={false} />
    </LiveFeedProvider>,
  );
}

const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;

describe("Live ops shared feed", () => {
  it("opens one stream and one snapshot read for the list and the map together", async () => {
    renderWorkspace();
    await screen.findByText(/Aiko T\. · Glebe House/);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/admin/ops/live-locations/stream");
    expect(calls("/api/admin/ops/live-locations")).toBe(1);
    expect(calls("/api/admin/ops/live-board")).toBe(1);
  });

  it("shows real counts beyond eight and one h1", async () => {
    renderWorkspace();
    const chip = await screen.findByRole("button", { name: /Exceptions\s*14/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Not started\s*9/ })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Live ops");
  });

  it("reflects the stream state: connecting, live, reconnecting", async () => {
    renderWorkspace();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    act(() => FakeEventSource.instances[0].onopen?.());
    expect(screen.getByText("Live")).toBeInTheDocument();
    act(() => FakeEventSource.instances[0].onerror?.());
    expect(screen.getByText(/^Reconnecting/)).toBeInTheDocument();
  });

  it("gives a late cleaner Call, Message, Tell client and Reassign, and opens the shared assign panel", async () => {
    renderWorkspace();
    await screen.findByText("18 min late");
    expect(screen.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:0400000003");
    expect(screen.getByRole("link", { name: "Message" })).toHaveAttribute("href", "/v2/admin/jobs/j1?tab=messages");
    expect(screen.getByRole("link", { name: "Tell client" })).toHaveAttribute("href", "/v2/admin/jobs/j1?tab=messages");
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    expect(screen.getByRole("dialog", { name: "Job preview" })).toHaveTextContent("j1");
  });

  it("approves a continuation through the unchanged endpoint and body", async () => {
    renderWorkspace();
    await screen.findByText(/Jane C\. · Coogee Terrace/);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Approved\. Updating/);
    const patch = fetchMock.mock.calls.find(([u]) => String(u).startsWith("/api/admin/job-continuations/"));
    expect(patch?.[0]).toBe("/api/admin/job-continuations/c1");
    expect(patch?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ decision: "APPROVE" }) });
  });

  it("keeps a declined-by-server continuation with the server's reason", async () => {
    continuationResponse = () => new Response(JSON.stringify({ error: "Continuation request is no longer pending." }), { status: 400 });
    renderWorkspace();
    await screen.findByText(/Jane C\. · Coogee Terrace/);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    // Declining now asks for the reason the cleaner sees (owner decision, third set item 5).
    const dialog = await screen.findByRole("dialog", { name: "Decline with a reason" });
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Finish today, the guest arrives at 3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Continuation request is no longer pending.");
    expect(within(dialog).getByLabelText("Reason (required)")).toHaveValue("Finish today, the guest arrives at 3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("shows on-site progress with its basis and the selected person's card", async () => {
    renderWorkspace();
    expect(await screen.findByText(/1 h 10 of 3 h 00 · 40% of checklist/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Aiko T\. · Glebe House/ }));
    await waitFor(() => expect(screen.getByText("Heading to Glebe House")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Manly Loft 13:00" })).toHaveAttribute("href", "/v2/admin/jobs/j9");
    expect(screen.getByRole("navigation", { name: "Also needs attention" })).toHaveTextContent("New leads 3");
  });
});
