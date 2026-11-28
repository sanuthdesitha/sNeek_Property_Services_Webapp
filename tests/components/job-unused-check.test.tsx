/**
 * "Looks unused — ask the office" screens (2026-11-28): the cleaner's ask
 * form (one request on a double tap, the draft and request key kept after a
 * failure, a late answer for another job ignored) and the office's answer in
 * Approvals (three answers, optional note, the job is not changed).
 */
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unusedCheckEligibility, isUnusedCheckDecision, UNUSED_CHECK_DECISION_LABELS } from "@/lib/jobs/unused-check-rules";

vi.mock("@/components/v2/cleaner/media-capture", () => ({
  MediaCapture: () => <div data-testid="media-capture" />,
}));

import { UnusedCheckRequest, UnusedCheckStatus } from "@/components/v2/cleaner/unused-check";
import { UnusedCheckPanel } from "@/components/v2/admin/approvals/panel/unused-check-panel";
import type { ApprovalQueueRow } from "@/lib/admin/approvals/rows";

type Deferred = { resolve: (value: Response) => void; promise: Promise<Response> };

function deferred(): Deferred {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const empty = (jobId: string) => ({ jobId, checks: [], canAsk: true, refusal: null });
const waitingCheck = (jobId: string) => ({ id: `${jobId}-check`, jobId, status: "WAITING", note: "Beds untouched", photoCount: 0, askedAt: "2026-11-28T00:00:00.000Z", askedByMe: true, decision: null, decisionNote: null, answeredAt: null });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unused-check rules", () => {
  it("offers asking only to an accepted cleaner on an open Airbnb turnover", () => {
    expect(unusedCheckEligibility({ jobType: "AIRBNB_TURNOVER", jobStatus: "IN_PROGRESS", responseStatus: "ACCEPTED" })).toEqual({ ok: true });
    expect(unusedCheckEligibility({ jobType: "AIRBNB_TURNOVER", jobStatus: "ASSIGNED", responseStatus: "ACCEPTED" })).toEqual({ ok: true });
    expect(unusedCheckEligibility({ jobType: "GENERAL_CLEAN", jobStatus: "IN_PROGRESS", responseStatus: "ACCEPTED" }).ok).toBe(false);
    expect(unusedCheckEligibility({ jobType: "AIRBNB_TURNOVER", jobStatus: "IN_PROGRESS", responseStatus: "PENDING" }).ok).toBe(false);
    for (const status of ["SUBMITTED", "COMPLETED", "INVOICED", "CANCELLED", "UNASSIGNED", null]) {
      expect(unusedCheckEligibility({ jobType: "AIRBNB_TURNOVER", jobStatus: status, responseStatus: "ACCEPTED" }).ok, String(status)).toBe(false);
    }
    expect(isUnusedCheckDecision("DO_NOT_CLEAN")).toBe(true);
    expect(isUnusedCheckDecision("SKIP")).toBe(false);
    expect(Object.values(UNUSED_CHECK_DECISION_LABELS)).toEqual(["Clean as normal", "Light refresh only", "Do not clean"]);
  });
});

describe("cleaner: Looks unused — ask the office", () => {
  it("sends one request on a double tap and shows the waiting state", async () => {
    const post = deferred();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === "POST" ? post.promise : Promise.resolve(json(empty("job-a")))));
    render(<UnusedCheckRequest jobId="job-a" />);
    const button = await screen.findByRole("button", { name: "Ask the office" });
    fireEvent.change(screen.getByLabelText("What you see (optional)"), { target: { value: "Towels folded" } });
    fireEvent.click(button);
    fireEvent.click(button);
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(1);
    const sent = JSON.parse(String((posts[0][1] as RequestInit).body));
    expect(sent).toMatchObject({ note: "Towels folded", photoKeys: [] });
    expect(sent.requestKey).toMatch(/^unused-[A-Za-z0-9_-]+$/);
    // Fields are frozen while it is sending.
    expect(screen.getByLabelText("What you see (optional)")).toBeDisabled();
    await act(async () => post.resolve(json({ outcome: "CREATED", checks: [waitingCheck("job-a")] }, 201)));
    expect(await screen.findByText("Waiting for the office")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask the office" })).toBeNull();
  });

  it("keeps the note and the same request key after a failed send, for an explicit retry", async () => {
    const posts: string[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(json(empty("job-b")));
      posts.push(String(init.body));
      return Promise.resolve(posts.length === 1 ? json({ error: "Could not reach the office. Your note is kept; try again." }, 500) : json({ outcome: "CREATED", checks: [waitingCheck("job-b")] }, 201));
    });
    render(<UnusedCheckRequest jobId="job-b" />);
    fireEvent.change(await screen.findByLabelText("What you see (optional)"), { target: { value: "Bins empty" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask the office" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your note is kept");
    expect(screen.getByLabelText("What you see (optional)")).toHaveValue("Bins empty");
    fireEvent.click(screen.getByRole("button", { name: "Ask the office" }));
    expect(await screen.findByText("Waiting for the office")).toBeInTheDocument();
    expect(JSON.parse(posts[1]).requestKey).toBe(JSON.parse(posts[0]).requestKey);
  });

  it("keeps the draft when the sheet closes and reopens on the same job, never on another job", async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(json(empty(url.includes("job-d") ? "job-d" : "job-c"))));
    const { unmount } = render(<UnusedCheckRequest jobId="job-c" />);
    fireEvent.change(await screen.findByLabelText("What you see (optional)"), { target: { value: "Looks untouched" } });
    unmount();
    const reopened = render(<UnusedCheckRequest jobId="job-c" />);
    expect(await screen.findByLabelText("What you see (optional)")).toHaveValue("Looks untouched");
    reopened.unmount();
    render(<UnusedCheckRequest jobId="job-d" />);
    expect(await screen.findByLabelText("What you see (optional)")).toHaveValue("");
  });

  it("ignores a late answer for the previous job and shows the current job's answer", async () => {
    const slow = deferred();
    fetchMock.mockImplementation((url: string) => (url.includes("job-old") ? slow.promise : Promise.resolve(json({
      jobId: "job-new",
      checks: [{ ...waitingCheck("job-new"), status: "ANSWERED", decision: "LIGHT_REFRESH", decisionNote: "Towels only", answeredAt: "2026-11-28T00:10:00.000Z" }],
      canAsk: true,
      refusal: null,
    }))));
    const { rerender } = render(<UnusedCheckStatus key="job-old" jobId="job-old" revision={0} />);
    rerender(<UnusedCheckStatus key="job-new" jobId="job-new" revision={0} />);
    expect(await screen.findByText("Office answer: Light refresh only")).toBeInTheDocument();
    await act(async () => slow.resolve(json({ jobId: "job-old", checks: [{ ...waitingCheck("job-old"), status: "ANSWERED", decision: "DO_NOT_CLEAN", answeredAt: "2026-11-28T00:05:00.000Z" }], canAsk: false, refusal: null })));
    expect(screen.queryByText("Office answer: Do not clean")).toBeNull();
    expect(screen.getByText("Note from the office: “Towels only”")).toBeInTheDocument();
  });

  it("separates loading, failure and nothing-asked; Do not clean says the office updates the job", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "You are not assigned to this job." }, 403));
    render(<UnusedCheckRequest jobId="job-e" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByRole("alert")).toHaveTextContent("You are not assigned to this job.");
    fetchMock.mockResolvedValueOnce(json({ jobId: "job-e", checks: [{ ...waitingCheck("job-e"), status: "ANSWERED", decision: "DO_NOT_CLEAN", answeredAt: "2026-11-28T00:05:00.000Z" }], canAsk: true, refusal: null }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Office answer: Do not clean")).toBeInTheDocument();
    expect(screen.getByText(/the office will update the job/i)).toBeInTheDocument();
    expect(screen.getByText(/pay are not changed/i)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(json(empty("job-f")));
    const { container } = render(<UnusedCheckStatus jobId="job-f" revision={0} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/cleaner/jobs/job-f/unused-check", expect.anything()));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("office: the answer in Approvals", () => {
  const row = {
    queue: "unusedChecks",
    id: "check-1",
    jobId: "job-1",
    who: "Casey Cleaner",
    record: {
      id: "check-1",
      jobId: "job-1",
      note: "Beds untouched",
      createdAt: "2026-11-28T00:00:00.000Z",
      cleaner: { name: "Casey Cleaner" },
      job: { id: "job-1", jobNumber: "JOB-1", scheduledDate: "2026-11-28T00:00:00.000Z", startTime: "10:00" },
      attachmentUrls: [],
    },
  } as unknown as ApprovalQueueRow;

  it("needs a choice, then sends the answer with the optional note to the answer route", async () => {
    const decide = vi.fn(async () => true);
    render(<UnusedCheckPanel row={row} busy={false} decide={decide} reload={async () => undefined} timezone="Australia/Sydney" />);
    expect(screen.getByText("“Beds untouched”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Send answer/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose an answer first.");
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /Do not clean/ }));
    expect(screen.getByText(/not cancelled, skipped or re-priced/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Note to the cleaner (optional)"), { target: { value: "Guest cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: /Send answer/ }));
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide).toHaveBeenCalledWith({
      url: "/api/admin/job-unused-checks/check-1",
      method: "PATCH",
      body: { decision: "DO_NOT_CLEAN", note: "Guest cancelled" },
      successMsg: "Answer sent: Do not clean",
    });
  });

  it("freezes the answer while it is being sent", () => {
    render(<UnusedCheckPanel row={row} busy decide={vi.fn()} reload={async () => undefined} timezone="Australia/Sydney" />);
    expect(screen.getByRole("radio", { name: /Clean as normal/ })).toBeDisabled();
    expect(screen.getByLabelText("Note to the cleaner (optional)")).toBeDisabled();
  });
});
