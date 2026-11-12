/**
 * Office actions wired into existing screens: Laundry nudges, Accounts bulk
 * Message, Command's continuation decline and the job page's decline.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/v2/admin/jobs/job-peek-panel", () => ({ JobPeekPanel: () => null }));
vi.mock("@/components/v2/admin/jobs/submission-review", () => ({ AccessMediaGallery: () => null }));

import { LaundryNudgeActions } from "@/components/v2/admin/laundry/laundry-nudge";
import type { RunPanelTask } from "@/components/v2/admin/laundry/laundry-run-panel";
import { AccountsMessageDialog } from "@/components/v2/admin/accounts/hub/accounts-message-dialog";
import { planStaffMessage } from "@/lib/accounts/message-recipients";
import type { AccountRow } from "@/lib/accounts/list/types";
import { WorkQueue } from "@/components/v2/admin/command/work-queue";
import type { WorkQueuePayload } from "@/lib/dashboard/work-queue-types";
import { JobContinuationReviews, type JobContinuationRow } from "@/components/v2/admin/jobs/job-detail-reviews";

afterEach(() => vi.unstubAllGlobals());

function outcomes(name: string, id: string) {
  return { outcomes: [{ userId: id, name, transport: "INBOX", path: "pipeline", state: "queued" }, { userId: id, name, transport: "WEB_PUSH", path: "direct", state: "requested" }], refused: [] };
}

describe("Laundry requests: the partner's team for pickup and drop-off, the cleaner for the bags", () => {
  const task = (patch: Partial<RunPanelTask>): RunPanelTask => ({
    id: "t1", jobId: "j1", status: "PENDING", pickupDate: "2026-11-11T00:00:00.000Z", dropoffDate: "2026-11-12T00:00:00.000Z",
    property: { name: "Bondi Flat" }, job: { status: "SUBMITTED" }, cleaners: ["Ana"], readiness: true, exceptions: [],
    supplier: { id: "s1", name: "Fresh Linen" }, supplierTeam: { supplierName: "Fresh Linen", count: 1, names: ["Tom"] }, ...patch,
  } as RunPanelTask);

  it("asks the cleaner only about the bags, and the laundry team about pickup, return and the photo", () => {
    const { rerender } = render(<LaundryNudgeActions task={task({ pickupDate: "2026-11-13T00:00:00.000Z" })} todayKey="2026-11-11" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    rerender(<LaundryNudgeActions task={task({ readiness: false, exceptions: [{ code: "NOT_READY", label: "Not ready" }] })} todayKey="2026-11-11" />);
    expect(screen.getByRole("button", { name: "Ask cleaner" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /laundry team/ })).toBeNull();
    // Bags ready on the pickup day: the partner's team confirms the pickup, not the cleaner.
    rerender(<LaundryNudgeActions task={task({})} todayKey="2026-11-11" />);
    expect(screen.getByRole("button", { name: "Ask laundry team to confirm pickup" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Ask cleaner" })).toBeNull();
    rerender(<LaundryNudgeActions task={task({ status: "PICKED_UP", dropoffDate: "2026-11-13T00:00:00.000Z", exceptions: [{ code: "OVER_TURNAROUND", label: "Over" }] })} todayKey="2026-11-11" />);
    expect(screen.getByRole("button", { name: "Ask laundry team: when will it be back?" })).toBeInTheDocument();
    rerender(<LaundryNudgeActions task={task({ status: "DROPPED", exceptions: [{ code: "NO_DROP_PHOTO", label: "No drop photo" }] })} todayKey="2026-11-11" />);
    expect(screen.getByRole("button", { name: "Ask laundry team for a photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request photo" })).toBeNull();
  });

  it("disables a team request with the reason when the partner has no portal users", () => {
    render(<LaundryNudgeActions task={task({ supplierTeam: { supplierName: "Fresh Linen", count: 0, names: [] } })} todayKey="2026-11-11" />);
    const button = screen.getByRole("button", { name: "Ask laundry team to confirm pickup" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Fresh Linen has no laundry portal users linked.*Chase supplier/);
  });

  it("sends a team request to the partner's team through its own route with a fixed key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(outcomes("Tom", "l1")), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LaundryNudgeActions task={task({ status: "DROPPED", exceptions: [{ code: "NO_DROP_PHOTO", label: "No drop photo" }] })} todayKey="2026-11-11" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask laundry team for a photo" }));
    const dialog = await screen.findByRole("dialog", { name: "Ask the laundry team for a drop-off photo" });
    expect(within(dialog).getByText("Fresh Linen laundry team: Tom")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByText("In-app inbox: Queued")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/notifications/actions/laundry-team-request");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ laundryTaskId: "t1", kind: "TEAM_PHOTO", transports: ["PUSH"] });
    expect(body.idempotencyKey).toMatch(/^nudge:t1:TEAM_PHOTO:\d+$/);
  });

  it("confirms recipient and transport for Ask cleaner, shows real states and the cool-down refusal", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => (++call === 1
      ? new Response(JSON.stringify(outcomes("Ana", "c1")), { status: 200 })
      : new Response(JSON.stringify({ error: "Already asked at 12:05. You can ask again after 12:35." }), { status: 409 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<LaundryNudgeActions task={task({ readiness: false, exceptions: [{ code: "NOT_READY", label: "Not ready" }] })} todayKey="2026-11-11" />);
    fireEvent.click(screen.getByRole("button", { name: "Ask cleaner" }));
    let dialog = await screen.findByRole("dialog", { name: "Ask the cleaner about the bags" });
    expect(within(dialog).getByText("Ana")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("In-app inbox with phone and browser push")).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByText("In-app inbox: Queued")).toBeInTheDocument();
    expect(within(dialog).getByText("Browser push: Requested (no receipt)")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/notifications/actions/laundry-nudge");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ laundryTaskId: "t1", kind: "ASK_CLEANER", transports: ["PUSH"] });
    expect(body.idempotencyKey).toMatch(/^nudge:t1:ASK_CLEANER:\d+$/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask cleaner" }));
    dialog = await screen.findByRole("dialog", { name: "Ask the cleaner about the bags" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Already asked at 12:05");
  });
});

describe("Accounts bulk Message", () => {
  const person = (id: string, role: string, status: string, name: string): AccountRow => ({ id, role, status, name, email: `${id}@example.invalid` } as unknown as AccountRow);
  const rows = [person("c1", "CLEANER", "ACTIVE", "Ana"), person("cl", "CLIENT", "ACTIVE", "Client Co"), person("old", "CLEANER", "DISABLED", "Old Timer"), person("inv", "LAUNDRY", "INVITED", "New Driver")];

  it("works out who is skipped by the route's own rules", () => {
    const plan = planStaffMessage(rows);
    expect(plan.recipients.map((row) => row.id)).toEqual(["c1", "inv"]);
    expect(plan.skipped.map(({ row }) => row.id)).toEqual(["cl", "old"]);
  });

  it("shows the skipped people before sending and each recipient's outcome after", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ outcomes: [...outcomes("Ana", "c1").outcomes, ...outcomes("New Driver", "inv").outcomes], refused: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountsMessageDialog open rows={rows} onClose={vi.fn()} onRunningChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Message selected staff" });
    const skipped = within(dialog).getByRole("list", { name: "Skipped" });
    expect(within(skipped).getByText("Client Co")).toBeInTheDocument();
    expect(within(skipped).getByText("Account is disabled.")).toBeInTheDocument();
    expect(within(dialog).getByText("2 of 4 selected will be messaged.")).toBeInTheDocument();
    const send = within(dialog).getByRole("button", { name: "Message 2" });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "Roster" } });
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "New roster is up" } });
    fireEvent.click(within(dialog).getByLabelText("Email"));
    fireEvent.click(send);
    const results = await within(dialog).findByRole("list", { name: "Results" });
    expect(within(results).getByText("Ana")).toBeInTheDocument();
    expect(within(results).getByText("New Driver")).toBeInTheDocument();
    expect(within(results).getAllByText("In-app inbox: Queued")).toHaveLength(2);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ recipientIds: ["c1", "inv"], subject: "Roster", body: "New roster is up", transports: ["PUSH", "EMAIL"] });
  });

  it("keeps the draft and shows the server's message when the send fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Check the message, recipients and transport." }), { status: 400 })));
    render(<AccountsMessageDialog open rows={rows} onClose={vi.fn()} onRunningChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Message selected staff" });
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "Roster" } });
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Body" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Message 2" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Check the message, recipients and transport.");
    expect(within(dialog).getByLabelText("Subject")).toHaveValue("Roster");
  });
});

describe("Command work queue: continuation decline", () => {
  const QUEUE: WorkQueuePayload = {
    items: [{
      id: "continuation:c1", kind: "continuation", category: "dispatch", urgency: "now", count: 1, href: "/v2/admin/jobs/j2",
      title: "Jane C. asks to continue later", detail: "Coogee · reason: oven",
      actions: [
        { kind: "request", label: "Decline", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "REJECT" }, doneLabel: "Continuation declined", reason: { field: "decisionNote", subject: "Jane C. · Coogee" } },
        { kind: "request", label: "Approve", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "APPROVE" }, doneLabel: "Continuation approved", primary: true },
      ],
    }],
    chips: [{ key: "all", label: "All", count: 1 }], unavailable: [], generatedAt: "2026-11-11T00:00:00Z",
  };

  it("uses the same reason dialog as Live ops and sends the reason as decisionNote", async () => {
    const fetchMock = vi.fn(async (url: string) => (url.startsWith("/api/admin/job-continuations/")
      ? new Response(JSON.stringify({ status: "REJECTED" }), { status: 200 })
      : new Response(JSON.stringify({ ...QUEUE, items: [] }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkQueue initial={QUEUE} timeZone="Australia/Sydney" readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog", { name: "Decline with a reason" });
    expect(within(dialog).getByText("Jane C. · Coogee")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Finish today" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(screen.queryByText("Jane C. asks to continue later")).toBeNull());
    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/admin/job-continuations/")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toEqual({ decision: "REJECT", decisionNote: "Finish today" });
  });
});

describe("Job page: continuation reject", () => {
  it("cannot reject without a reason", () => {
    const request: JobContinuationRow = {
      id: "c1", status: "PENDING", reason: "Oven", requestedAt: "2026-11-11T00:00:00Z", requestedBy: "Jane C.", preferredDate: null,
      estimatedRemainingHours: null, decidedAt: null, decidedBy: null, decisionNote: null, continuationJobId: null, loggedCleaners: [],
    };
    render(<JobContinuationReviews requests={[request]} />);
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    const confirm = screen.getByRole("button", { name: "Reject request" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText("Required — sent to the requesting cleaner.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Why is this being declined?"), { target: { value: "Finish today" } });
    expect(confirm).toBeEnabled();
  });
});
