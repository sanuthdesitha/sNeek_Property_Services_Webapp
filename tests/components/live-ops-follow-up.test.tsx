/**
 * Live ops follow-up (owner decisions, third set items 2, 3 and 5):
 * Notify client on a late job, Pause clock on an off-site clock, and the
 * required reason when declining a continuation request.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/maps/loader", () => ({ ensureGoogleMaps: () => Promise.reject(new Error("no key")) }));
vi.mock("@/components/v2/admin/jobs/job-peek-panel", () => ({ JobPeekPanel: () => null }));

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
    sameDayCheckinTime: null, cleaners: [{ id: "u1", name: "Aiko T.", phone: null }], minutes: 18, etaClock: "10:48",
    distanceMeters: null, elapsedMinutes: null, allocatedMinutes: null, progress: null, openTimeLogId: null,
    field: { address: null, safety: null, checkInDistanceMeters: null, gpsCheckInAt: null },
    ...overrides,
  };
}

let board: LiveBoardPayload;
let fetchMock: ReturnType<typeof vi.fn>;
let preview: Record<string, unknown>;
let sendResponse: () => Response;

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  board = {
    todayKey: "2026-11-11", timeZone: "Australia/Sydney",
    jobs: [
      row({ etaAt: new Date(Date.now() + 25 * 60_000).toISOString(), delayNotice: null }),
      row({ jobId: "j4", propertyName: "Manly Loft", state: "off-site", status: "IN_PROGRESS", minutes: 12, distanceMeters: 900, cleaners: [{ id: "u2", name: "Marco R.", phone: null }], openTimeLogId: "log-9", runningClocks: [{ timeLogId: "log-9", userId: "u2", name: "Marco R.", startedAt: "2026-11-11T00:00:00Z" }] }),
    ],
    continuations: [{ id: "c1", jobId: "j3", propertyName: "Coogee Terrace", cleanerName: "Jane C.", reason: "Oven", remainingHours: 2, requestedAt: "x" }],
    drivers: [], cleaners: [],
    counts: { exceptions: 3, onSite: 0, travelling: 0, notStarted: 0, cleanersOnShift: 2, driversOnShift: 0 },
    generatedAt: "2026-11-11T00:00:00Z",
  };
  preview = {
    jobId: "j1", propertyName: "Glebe House", subject: "Your clean is running late", etaMinutes: 25,
    body: "Your clean at Glebe House is running late. The new estimate is about 25 minutes.",
    recipients: [{ id: "cu", name: "Jo Client", email: "jo@example.invalid" }], blocked: null, switchedOff: [], lastRequest: null,
  };
  sendResponse = () => new Response(JSON.stringify({ outcomes: [
    { userId: "cu", name: "Jo Client", transport: "INBOX", path: "pipeline", state: "inbox_available" },
    { userId: "cu", name: "Jo Client", transport: "EMAIL", path: "direct", state: "provider_accepted" },
  ], refused: [] }), { status: 200 });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/ops/live-locations") return new Response(JSON.stringify({ pings: [] }), { status: 200 });
    if (url === "/api/admin/ops/live-board") return new Response(JSON.stringify(board), { status: 200 });
    if (url.startsWith("/api/admin/notifications/actions/client-delay?")) return new Response(JSON.stringify(preview), { status: 200 });
    if (url === "/api/admin/notifications/actions/client-delay" && init?.method === "POST") return sendResponse();
    if (url === "/api/admin/jobs/j4/pause-clock") {
      return new Response(JSON.stringify({ timeLogId: "log-9", stoppedAt: "2026-11-11T01:40:00.000Z", durationM: 85, jobStatus: "PAUSED", noticeError: null, notice: [{ userId: "u2", name: "Marco R.", transport: "INBOX", path: "pipeline", state: "inbox_available" }] }), { status: 200 });
    }
    if (url.startsWith("/api/admin/job-continuations/")) return new Response(JSON.stringify({ id: "c1", status: "REJECTED" }), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The page passes each flag from the shared send rule (ADMIN, or OPS_MANAGER with the Jobs pack). */
function renderOps(canSend: boolean | { notify: boolean; pause: boolean }) {
  const flags = typeof canSend === "boolean" ? { notify: canSend, pause: canSend } : canSend;
  return render(
    <LiveFeedProvider>
      <LiveOpsWorkspace properties={[]} attention={null} initialView="exceptions" todayKey="2026-11-11" timeZone="Australia/Sydney" readOnly={false} canNotifyClient={flags.notify} canPauseClock={flags.pause} />
    </LiveFeedProvider>,
  );
}

const posts = (url: string) => fetchMock.mock.calls.filter(([u, init]) => u === url && (init as RequestInit | undefined)?.method === "POST");

describe("Notify client of delay", () => {
  it("is offered only where the send rule allows it; others keep the Messages link", async () => {
    renderOps(false);
    await screen.findByText("18 min late");
    expect(screen.getByRole("link", { name: "Tell client" })).toHaveAttribute("href", "/v2/admin/jobs/j1?tab=messages");
    expect(screen.queryByRole("button", { name: "Notify client" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause clock" })).toBeNull();
  });

  it("shows each action by its own flag", async () => {
    renderOps({ notify: true, pause: false });
    expect(await screen.findByRole("button", { name: "Tell client" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause clock" })).toBeNull();
  });

  it("confirms exactly what will be sent, then shows the transports' real states (never 'sent')", async () => {
    renderOps(true);
    fireEvent.click(await screen.findByRole("button", { name: "Tell client" }));
    const dialog = await screen.findByRole("dialog", { name: "Notify the client of the delay" });
    expect(await within(dialog).findByText("Jo Client · jo@example.invalid")).toBeInTheDocument();
    expect(within(dialog).getByText(preview.body as string)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("client-delay?jobId=j1&etaMinutes=25"))).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Notify client" }));
    expect(await within(dialog).findByText("In-app inbox: In their inbox")).toBeInTheDocument();
    expect(within(dialog).getByText("Email: Accepted by the provider")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/\bSent\b|Delivered/);
    const [, init] = posts("/api/admin/notifications/actions/client-delay")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ jobId: "j1", transports: ["PUSH", "EMAIL"], idempotencyKey: "delay:j1:2026-11-11", etaMinutes: 25 });
  });

  it("shows the refusal when the client switched notifications off and sends nothing", async () => {
    preview = { ...preview, recipients: [], blocked: "This client has switched off job notifications." };
    renderOps(true);
    fireEvent.click(await screen.findByRole("button", { name: "Tell client" }));
    const dialog = await screen.findByRole("dialog", { name: "Notify the client of the delay" });
    expect(await within(dialog).findByText("Not sent: This client has switched off job notifications.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Notify client" })).toBeDisabled();
    expect(posts("/api/admin/notifications/actions/client-delay")).toHaveLength(0);
  });

  it("says when a notice was already requested and needs an explicit Send another, with a new key", async () => {
    board.jobs[0] = { ...board.jobs[0], delayNotice: { at: "2026-11-11T00:05:00.000Z", byName: "Ann Admin" } };
    preview = { ...preview, lastRequest: { at: "2026-11-11T00:05:00.000Z", byName: "Ann Admin" } };
    renderOps(true);
    expect(await screen.findByText("Client delay notice requested at 11:05 by Ann Admin.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tell client again…" }));
    const dialog = await screen.findByRole("dialog", { name: "Notify the client of the delay" });
    expect(await within(dialog).findByText("Already requested at 11:05 by Ann Admin.")).toBeInTheDocument();
    const send = within(dialog).getByRole("button", { name: "Send another" });
    expect(send).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("Send another notice"));
    fireEvent.click(send);
    await waitFor(() => expect(posts("/api/admin/notifications/actions/client-delay")).toHaveLength(1));
    const sent = JSON.parse(String((posts("/api/admin/notifications/actions/client-delay")[0][1] as RequestInit).body));
    expect(sent.idempotencyKey).not.toBe("delay:j1:2026-11-11");
    expect(sent.idempotencyKey).toMatch(/^delay-again-/);
  });

  it("keeps the dialog open with the server's message when the send fails", async () => {
    sendResponse = () => new Response(JSON.stringify({ error: "This client has no active login to notify." }), { status: 400 });
    renderOps(true);
    fireEvent.click(await screen.findByRole("button", { name: "Tell client" }));
    const dialog = await screen.findByRole("dialog", { name: "Notify the client of the delay" });
    await within(dialog).findByText("Jo Client · jo@example.invalid");
    fireEvent.click(within(dialog).getByRole("button", { name: "Notify client" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This client has no active login to notify.");
    expect(within(dialog).getByRole("button", { name: "Notify client" })).toBeEnabled();
  });
});

describe("Pause clock", () => {
  it("requires a reason, sends the cleaner and transports, and reports what happened", async () => {
    renderOps(true);
    fireEvent.click(await screen.findByRole("button", { name: "Pause clock" }));
    expect(screen.getByRole("link", { name: "Review clock" })).toHaveAttribute("href", "/v2/admin/jobs/j4?tab=activity");
    const dialog = await screen.findByRole("dialog", { name: "Pause Marco R.'s clock" });
    const confirm = within(dialog).getByRole("button", { name: "Pause clock" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason (required, the cleaner sees it)"), { target: { value: "Left the site at 11:30" } });
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(/Paused at 12:40\. This clock segment holds 85 min\./)).toBeInTheDocument();
    expect(within(dialog).getByText("In-app inbox: In their inbox")).toBeInTheDocument();
    const [, init] = posts("/api/admin/jobs/j4/pause-clock")[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ cleanerId: "u2", reason: "Left the site at 11:30", transports: ["PUSH"] });
  });

  it("closes on Escape and returns focus to the opener", async () => {
    renderOps(true);
    const opener = await screen.findByRole("button", { name: "Pause clock" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Pause Marco R.'s clock" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pause Marco R.'s clock" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});

describe("Declining a continuation request", () => {
  it("cannot be sent without a reason and sends the reason as the decision note", async () => {
    renderOps(true);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline with a reason" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Give a reason. The cleaner sees it.");
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/admin/job-continuations/"))).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Finish today please" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Decline with a reason" })).toBeNull());
    const call = fetchMock.mock.calls.find(([u]) => String(u).startsWith("/api/admin/job-continuations/"));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ decision: "REJECT", decisionNote: "Finish today please" });
    expect(await screen.findByText("Declined. Updating…")).toBeInTheDocument();
  });
});
