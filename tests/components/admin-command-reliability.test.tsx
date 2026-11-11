/**
 * Command reliability. Rewritten for the November 2026 redesign: the old page
 * failed as a whole when any of its seven queries failed; each section now
 * loads, fails and retries on its own, and the old "Needs attention" list is
 * the work queue. The legacy guarantees kept from the old file are:
 * no false empty state after a failure, no private error text, every pending
 * approval category surfaced with its destination, and no "all clear" while
 * pending work exists (see also tests/lib/work-queue.test.ts and
 * tests/lib/command-sections.test.ts).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/v2/admin/jobs/job-peek-panel", () => ({
  JobPeekPanel: ({ jobId }: { jobId: string | null }) => (jobId ? <div role="dialog" aria-label="Job preview">{jobId}</div> : null),
}));

import { CommandTiles } from "@/components/v2/admin/command/command-tiles";
import { WorkQueue } from "@/components/v2/admin/command/work-queue";
import { summaryItems } from "@/lib/dashboard/work-queue";
import type { WorkQueuePayload } from "@/lib/dashboard/work-queue-types";
import type { CommandTilesPayload } from "@/lib/dashboard/command-types";
import type { AdminAttentionSummary } from "@/lib/dashboard/immediate-attention";

const TZ = "Australia/Sydney";

const QUEUE: WorkQueuePayload = {
  items: [
    {
      id: "continuation:c1", kind: "continuation", category: "dispatch", urgency: "now", count: 1, href: "/v2/admin/jobs/j2",
      title: "Jane C. asks to continue on 2026-11-12", detail: "Coogee Terrace · 2 h left · reason: oven not finished",
      actions: [
        { kind: "request", label: "Decline", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "REJECT" }, doneLabel: "Continuation declined", reason: { field: "decisionNote", subject: "Jane C. · Coogee Terrace" } },
        { kind: "request", label: "Approve", method: "PATCH", endpoint: "/api/admin/job-continuations/c1", body: { decision: "APPROVE" }, doneLabel: "Continuation approved", primary: true },
      ],
    },
    {
      id: "unassigned:j1", kind: "unassigned-soon", category: "dispatch", urgency: "now", count: 1, href: "/v2/admin/jobs/j1",
      title: "Unassigned clean, tomorrow 10:00", detail: "The Bondi Studio · Airbnb turnover",
      actions: [{ kind: "assign", label: "Suggest cleaner", jobId: "j1" }, { kind: "assign", label: "Assign", jobId: "j1", primary: true }],
    },
    {
      id: "invoices-draft:all", kind: "invoices-draft", category: "money", urgency: "week", count: 6, href: "/v2/admin/finance?tab=invoices&status=DRAFT",
      title: "6 draft invoices ready for review", detail: "Drafts are not sent until approved.", actions: [{ kind: "link", label: "Review batch", href: "/v2/admin/finance?tab=invoices&status=DRAFT" }],
    },
  ],
  chips: [{ key: "all", label: "All", count: 8 }, { key: "dispatch", label: "Dispatch", count: 2 }, { key: "money", label: "Money", count: 6 }],
  unavailable: [],
  generatedAt: "2026-11-11T02:00:00Z",
};

const TILES: CommandTilesPayload = { tiles: [{ key: "unassigned", label: "Unassigned, next 48 h", count: 3, badge: { text: "Needs you", tone: "bad" }, href: "/v2/admin/jobs?statusChip=UNASSIGNED" }] };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(QUEUE), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("section isolation", () => {
  it("shows one failed section with its own Retry while the others render, without private detail", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/admin/command/queue" ? new Response(JSON.stringify({ error: "private database diagnostic" }), { status: 500 }) : new Response("{}", { status: 200 }));
    render(<><CommandTiles initial={TILES} timeZone={TZ} /><WorkQueue initial={null} timeZone={TZ} readOnly={false} /></>);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The work queue could not be loaded.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Unassigned, next 48 h\s*3\s*Needs you/ })).toHaveAttribute("href", "/v2/admin/jobs?statusChip=UNASSIGNED");
    expect(screen.queryByText(/private database diagnostic/)).toBeNull();
    expect(screen.queryByText("Nothing needs a decision right now.")).toBeNull();
  });

  it("retries just that section", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    render(<WorkQueue initial={null} timeZone={TZ} readOnly={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Jane C. asks to continue on 2026-11-12")).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/admin/command/queue")).toBe(true);
  });

  it("does not claim all clear when a source could not be read", () => {
    render(<WorkQueue initial={{ ...QUEUE, items: [], chips: [{ key: "all", label: "All", count: 0 }], unavailable: ["Approval and case counts"] }} timeZone={TZ} readOnly={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not shown because they could not be read: Approval and case counts");
    expect(screen.queryByText("Nothing needs a decision right now.")).toBeNull();
  });
});

describe("work queue actions", () => {
  it("filters by chip with real counts", () => {
    render(<WorkQueue initial={QUEUE} timeZone={TZ} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Money\s*6/ }));
    expect(screen.queryByText("Unassigned clean, tomorrow 10:00")).toBeNull();
    expect(screen.getByText("6 draft invoices ready for review")).toBeInTheDocument();
  });

  it("removes a row only after the server confirms, then re-reads the queue", async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      url.startsWith("/api/admin/job-continuations/") ? new Promise<Response>((r) => { resolve = r; }) : Promise.resolve(new Response(JSON.stringify({ ...QUEUE, items: QUEUE.items.slice(1) }), { status: 200 })));
    render(<WorkQueue initial={QUEUE} timeZone={TZ} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("button", { name: "Approve…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();
    expect(screen.getByText("Jane C. asks to continue on 2026-11-12")).toBeInTheDocument();
    resolve(new Response(JSON.stringify({ status: "APPROVED" }), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("Jane C. asks to continue on 2026-11-12")).toBeNull());
    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/admin/job-continuations/"));
    expect(call?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ decision: "APPROVE" }) });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/command/queue")).toBe(true);
    expect(screen.getByText("Continuation approved: Jane C. asks to continue on 2026-11-12")).toBeInTheDocument();
  });

  it("keeps a refused row and shows the server's reason", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "Continuation request is no longer pending." }), { status: 400 }));
    render(<WorkQueue initial={QUEUE} timeZone={TZ} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    // Declining asks for the reason first (owner decision); the server's refusal shows in the dialog.
    const dialog = await screen.findByRole("dialog", { name: "Decline with a reason" });
    fireEvent.change(within(dialog).getByLabelText("Reason (required)"), { target: { value: "Please finish today" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline request" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Continuation request is no longer pending.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Jane C. asks to continue on 2026-11-12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("says the outcome is unknown when the server does not answer", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("network"); });
    render(<WorkQueue initial={QUEUE} timeZone={TZ} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No answer from the server. Check the record before trying again.");
  });

  it("opens the shared assign panel for an unassigned job", () => {
    render(<WorkQueue initial={QUEUE} timeZone={TZ} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(screen.getByRole("dialog", { name: "Job preview" })).toHaveTextContent("j1");
  });
});

const EMPTY_SUMMARY: AdminAttentionSummary = {
  pendingPayRequests: 0, pendingTimeAdjustments: 0, pendingClientTaskRequests: 0, flaggedLaundry: 0, pendingLaundryRescheduleDraft: 0,
  unassignedJobs: 0, highCases: 0, newCases: 0, pendingContinuations: 0, pendingClientApprovals: 0, pendingQaOutcomes: 0,
  pendingTimingRequests: 0, pendingQaReworkTransfers: 0, pendingSkipRequests: 0, openCases: 0, overdueCases: 0, attentionCount: 0,
};

it.each([
  ["pendingTimeAdjustments", "clock-adjustment", "/v2/admin/approvals"], ["pendingClientTaskRequests", "client-task", "/v2/admin/approvals"],
  ["pendingTimingRequests", "timing-request", "/v2/admin/approvals"], ["pendingQaReworkTransfers", "qa-rework", "/v2/admin/approvals"],
  ["pendingSkipRequests", "skip-request", "/v2/admin/approvals"], ["pendingQaOutcomes", "qa-outcome", "/v2/admin/approvals"],
  ["pendingLaundryRescheduleDraft", "laundry-draft", "/v2/admin/laundry"], ["pendingClientApprovals", "client-approval", "/v2/admin/approvals"],
  ["pendingPayRequests", "pay-request", "/v2/admin/finance?tab=adjustments"], ["flaggedLaundry", "laundry-flagged", "/v2/admin/laundry"],
] as const)("surfaces %s as actionable work", (field, kind, href) => {
  const rows = summaryItems({ ...EMPTY_SUMMARY, [field]: 2 }, { unassignedSoonTotal: 0, flaggedInWindow: 0 });
  expect(rows).toEqual([expect.objectContaining({ kind, count: 2, href })]);
});

it("surfaces unassigned work outside the next 48 hours and non-overdue cases", () => {
  const rows = summaryItems({ ...EMPTY_SUMMARY, unassignedJobs: 5, openCases: 3, overdueCases: 1 }, { unassignedSoonTotal: 2, flaggedInWindow: 0 });
  expect(rows.find((row) => row.kind === "unassigned-later")?.title).toBe("3 unassigned jobs outside the next 48 hours");
  expect(rows.find((row) => row.kind === "case-open")?.title).toBe("2 open cases without an overdue deadline");
  expect(rows.find((row) => row.kind === "case-overdue")?.title).toBe("1 overdue case past SLA");
});
