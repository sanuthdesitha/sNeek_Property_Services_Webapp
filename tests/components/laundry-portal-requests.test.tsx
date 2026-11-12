/**
 * Laundry portal "From the office" and the stop screen's pickup answers
 * (2026-11-12): a request is answered with a typed reply (same key kept after
 * a failure, frozen while sending, moved to Answered), "Yes, 15:30" answers
 * in one tap, and the pickup form follows the existing pickup rules (count
 * difference needs a reason and photo; an unknown outcome asks for a refresh).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/components/v2/cleaner/media-capture", () => ({
  MediaCapture: ({ onChange }: { onChange: (value: Array<{ key: string }>) => void }) => <button type="button" onClick={() => onChange([{ key: "laundry/pickup/tom/p.jpg" }])}>Add photo</button>,
}));
vi.mock("@/components/v2/laundry/laundry-board", () => ({ decodeQrFromFile: vi.fn() }));

import { OfficeRequestsInbox } from "@/components/v2/laundry/portal/office-requests-inbox";
import { StopPickupForm } from "@/components/v2/laundry/portal/stop-pickup-form";
import type { LaundryOfficeRequest } from "@/lib/laundry/office-request-types";
import type { useStopDraft } from "@/components/v2/laundry/portal/use-stop-draft";

afterEach(() => vi.unstubAllGlobals());

const request = (patch: Partial<LaundryOfficeRequest> = {}): LaundryOfficeRequest => ({
  id: "req1", taskId: "task1", kind: "TEAM_RETURN_ETA", badge: "Chase", title: "Glebe House set, when back?", text: "When back?", note: "Next guest Fri 14:00",
  askedAtLabel: "Thu 12 Nov 10:32", askedAt: "2026-11-12T00:00:00Z", propertyName: "Glebe House", state: "open", reminderNumber: 2, proposedTime: null, plannedTime: null,
  stopKind: "DROP", answers: ["RETURN_AT", "MESSAGE"], replies: [], ...patch,
});
const reply = { id: "r1", requestKind: "TEAM_RETURN_ETA", answer: "RETURN_AT", time: "14:00", date: "2026-11-13", note: null, byName: "Tom", at: "2026-11-12T01:00:00Z" };

describe("From the office", () => {
  it("answers 'when will it be back?' with a day and time, keeps the key after a failure, then shows it answered", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        bodies.push(JSON.parse(String(init.body)));
        return ++call === 1 ? Promise.reject(new TypeError("offline")) : new Response(JSON.stringify({ reply, replayed: false }), { status: 201 });
      }
      return new Response(JSON.stringify({ requests: [request({ state: "answered", replies: [reply as never] })], openCount: 0, windowHours: 72 }), { status: 200 });
    }));
    render(<OfficeRequestsInbox initial={{ requests: [request()], openCount: 1, windowHours: 72 }} todayKey="2026-11-12" focusTaskId={null} />);
    expect(screen.getByText("Reminder 2 · Thu 12 Nov 10:32")).toBeInTheDocument();
    expect(screen.getByText('"Next guest Fri 14:00"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Give return time" }));
    fireEvent.change(screen.getByLabelText("Back on"), { target: { value: "2026-11-13" } });
    fireEvent.change(screen.getByLabelText("At, optional"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not confirmed as sent/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    const answered = await screen.findByRole("heading", { name: "Answered" });
    expect(within(answered.parentElement as HTMLElement).getByText(/Back by .*13 Nov 14:00 · Tom/)).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ answer: "RETURN_AT", date: "2026-11-13", time: "14:00" });
    expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
  });

  it("confirms a proposed pickup time in one tap and refuses a 'can't' without a reason before sending", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST"
      ? new Response(JSON.stringify({ reply: { ...reply, requestKind: "TEAM_MOVE_PICKUP", answer: "CONFIRMED", time: "15:30", date: null } }), { status: 201 })
      : new Response(JSON.stringify({ requests: [], openCount: 0, windowHours: 72 }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<OfficeRequestsInbox initial={{ requests: [request({ id: "req2", kind: "TEAM_MOVE_PICKUP", badge: "Confirm pickup", title: "Coogee Terrace moved to 15:30", proposedTime: "15:30", stopKind: "PICKUP", answers: ["CONFIRMED", "CANNOT", "MESSAGE"] })], openCount: 1, windowHours: 72 }} todayKey="2026-11-12" focusTaskId={null} />);
    expect(screen.getByRole("link", { name: "Go to stop" })).toHaveAttribute("href", "/v2/laundry/stop/task1?kind=pickup");
    fireEvent.click(screen.getByRole("button", { name: "Can't today" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/why not/);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, 15:30" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, call]) => call?.method === "POST")!;
    expect(url).toBe("/api/laundry/office-requests/req2/reply");
    expect(JSON.parse(String(init!.body))).toMatchObject({ answer: "CONFIRMED", time: "15:30" });
  });
});

function draftState(patch: Partial<ReturnType<typeof useStopDraft>["draft"]> = {}) {
  const state = { draft: { readiness: null, bagCount: 2, reason: "", notes: "", photos: [], keyPhotos: [], ...patch }, update: vi.fn(), clear: vi.fn(), restored: false, persisted: null };
  return state as unknown as ReturnType<typeof useStopDraft>;
}

describe("stop pickup answers", () => {
  const task = { id: "task1", status: "CONFIRMED", updatedAt: "2026-11-12T00:00:00Z", propertyName: "The Bondi Studio" };

  it("requires a reason and a photo when the count differs from the cleaner's", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<StopPickupForm task={task} expected={2} baselineId="c1" draftState={draftState({ bagCount: 3 })} onDone={vi.fn()} onFailedPickup={vi.fn()} />);
    expect(screen.getByText("Expected 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/Why is it different/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup · 3 bags" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The count differs from 2. Add a reason and a pickup photo");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the existing pickup body and asks for a refresh when the outcome is unknown", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "Task status changed." }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StopPickupForm task={task} expected={2} baselineId="c1" draftState={draftState({ readiness: "READY" })} onDone={vi.fn()} onFailedPickup={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup · 2 bags" }));
    expect(await screen.findByRole("button", { name: "Refresh" })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/laundry/task1/status");
    expect(JSON.parse(String(init.body))).toEqual({ status: "PICKED_UP", confirm: true, expectedUpdatedAt: "2026-11-12T00:00:00Z", bagCount: 2, quantityBaselineId: "c1", pickupReadiness: "READY" });
    expect(screen.getByRole("button", { name: "Confirm pickup · 2 bags" })).toBeDisabled();
  });

  it("asks whether the linen was ready when the cleaner did not confirm", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const onFailed = vi.fn();
    render(<StopPickupForm task={{ ...task, status: "PENDING" }} expected={null} baselineId={null} draftState={draftState()} onDone={vi.fn()} onFailedPickup={onFailed} />);
    expect(screen.getByText("Was the linen ready? (required)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm pickup · 2 bags" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Was the linen ready/);
    fireEvent.click(screen.getByRole("button", { name: "Pickup failed, report it" }));
    expect(onFailed).toHaveBeenCalled();
  });
});
