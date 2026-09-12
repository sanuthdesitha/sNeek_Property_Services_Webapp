import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApprovalsBoard } from "@/components/v2/client/approvals-board";

const mocks = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));

const row = (id = "one", extra = {}) => ({
  version: "a".repeat(64),
  id, title: `Approval ${id}`, description: "Extra work", amount: 50, currency: "AUD",
  status: "PENDING", requestedAt: "2026-09-09T10:00:00Z", expiresAt: null,
  responseNote: null, property: null, job: null, ...extra,
});
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function identity(id = "client-1", role = "CLIENT", impersonation?: object) {
  mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id, role }, impersonation } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  identity();
});
afterEach(() => vi.unstubAllGlobals());

describe("client approvals reliability", () => {
  it.each(["Approve", "Decline", "Send counter-offer"])("requires a fresh snapshot after stale %s without resubmitting", async (action) => {
    const refresh = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockResolvedValueOnce(response([row()]))
      .mockResolvedValueOnce({ ...response({ code: "STALE_APPROVAL" }, false), status: 409 })
      .mockResolvedValueOnce(response([row("one", { version: "bad" })]))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(response([]));
    render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one");
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Keep my note" } });
    fireEvent.change(screen.getByLabelText(/Or propose a different amount/), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: action }));
    await screen.findByText(/Approval terms have changed/);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).expectedVersion).toBe("a".repeat(64));
    for (const name of ["Approve", "Decline", "Send counter-offer"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Approvals unavailable/);
    expect(screen.getByRole("button", { name: action })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("button", { name: action })).toBeDisabled();
    await act(async () => { refresh.resolve(response([row("one", { version: "b".repeat(64), amount: 70 })])); });
    expect(screen.queryByText(/Approval terms have changed/)).not.toBeInTheDocument();
    expect(screen.getByText("AUD 70.00")).toBeVisible();
    expect(screen.getByLabelText("Optional note")).toHaveValue("Keep my note");
    expect(screen.getByLabelText(/Or propose a different amount/)).toHaveValue(25);
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await screen.findByText("All clear");
    expect(JSON.parse(mocks.fetch.mock.calls[4][1].body)).toEqual(action === "Send counter-offer"
      ? { amount: 25, note: "Keep my note", expectedVersion: "b".repeat(64) }
      : { decision: action.toUpperCase(), responseNote: "Keep my note", expectedVersion: "b".repeat(64) });
  });

  it.each([401, 403])("clears rows and drafts on refresh %s", async (status) => {
    mocks.fetch.mockResolvedValueOnce(response([row()])).mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce({ ...response({}, false), status }).mockResolvedValueOnce(response([row()]));
    render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one");
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Private draft" } });
    fireEvent.change(screen.getByLabelText(/Or propose a different amount/), { target: { value: "23" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Approvals unavailable. Please retry.");
    expect(screen.queryByText("Approval one")).not.toBeInTheDocument();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Optional note")).toHaveValue("");
    expect(screen.getByLabelText(/Or propose a different amount/)).toHaveValue(null);
  });

  it.each(["Approve", "Send counter-offer"])("encodes IDs and clears denied %s submissions", async (action) => {
    mocks.fetch.mockResolvedValueOnce(response([row("one/two?#")]))
      .mockResolvedValueOnce({ ...response({}, false), status: 403 }).mockResolvedValueOnce(response([row()]));
    render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one/two?#");
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Private draft" } });
    fireEvent.change(screen.getByLabelText(/Or propose a different amount/), { target: { value: "23" } });
    fireEvent.click(screen.getByRole("button", { name: action }));
    await screen.findByText("Approvals unavailable. Please retry.");
    expect(mocks.fetch.mock.calls[1][0]).toBe(`/api/client/approvals/one%2Ftwo%3F%23/${action === "Approve" ? "respond" : "counter"}`);
    expect(screen.queryByText("Approval one/two?#")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Optional note")).toHaveValue("");
    expect(screen.getByLabelText(/Or propose a different amount/)).toHaveValue(null);
  });

  it.each([
    ["HTTP failure", () => Promise.resolve(response({ error: "offline" }, false))],
    ["network failure", () => Promise.reject(new Error("offline"))],
    ["invalid JSON", () => Promise.resolve({ ok: true, json: async () => { throw new Error("JSON"); } })],
    ["object instead of array", () => Promise.resolve(response({}))],
    ["null row", () => Promise.resolve(response([null]))],
    ["bad date", () => Promise.resolve(response([row("one", { requestedAt: "bad" })]))],
    ["missing version", () => Promise.resolve(response([row("one", { version: undefined })]))],
    ["invalid version", () => Promise.resolve(response([row("one", { version: "A".repeat(64) })]))],
    ["short version", () => Promise.resolve(response([row("one", { version: "a".repeat(63) })]))],
    ["bad expiry", () => Promise.resolve(response([row("one", { expiresAt: "bad" })]))],
    ["bad amount", () => Promise.resolve(response([row("one", { amount: "bad" })]))],
    ["nonfinite amount", () => Promise.resolve(response([row("one", { amount: Infinity })]))],
    ["bad status", () => Promise.resolve(response([row("one", { status: {} })]))],
    ["bad job", () => Promise.resolve(response([row("one", { job: { scheduledDate: "bad" } })]))],
    ["missing counter amount", () => Promise.resolve(response([row("one", { status: "COUNTERED" })]))],
    ["duplicate IDs", () => Promise.resolve(response([row(), row()]))],
  ])("keeps %s unavailable through retry until a valid empty result", async (_name, load) => {
    const retry = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockImplementationOnce(load).mockReturnValueOnce(retry.promise);
    render(<ClientApprovalsBoard />);
    await screen.findByText("Approvals unavailable. Please retry.");
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Approvals unavailable. Please retry.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retrying..." })).toBeDisabled();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    await act(async () => { retry.resolve(response([])); });
    expect(await screen.findByText("All clear")).toBeVisible();
  });

  it("preserves draft and recorded response notes across failed and malformed refreshes", async () => {
    const refreshing = deferred<ReturnType<typeof response>>();
    const rows = [row(), row("past", { status: "APPROVED", responseNote: "Agreed on scope" })];
    mocks.fetch.mockResolvedValueOnce(response(rows)).mockResolvedValueOnce(response({}))
      .mockReturnValueOnce(refreshing.promise).mockResolvedValueOnce(response([row(), { id: "broken" }]))
      .mockResolvedValueOnce(response(rows));
    render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one");
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Keep this note" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("status");
    expect(screen.getByLabelText("Optional note")).toHaveValue("Keep this note");
    expect(screen.getByText(/Agreed on scope/)).toBeVisible();
    await act(async () => { refreshing.resolve({ ...response({}, false), status: 503 } as ReturnType<typeof response>); });
    expect(await screen.findByText(/this view may be incomplete or out of date/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
    expect(screen.getByText("Approval one")).toBeVisible();
    expect(screen.getByText(/Agreed on scope/)).toBeVisible();
    expect(screen.queryByText("All clear")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Approvals unavailable/)).not.toBeInTheDocument());
    expect(screen.getByLabelText("Optional note")).toHaveValue("Keep this note");
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual({ decision: "APPROVE", expectedVersion: "a".repeat(64), responseNote: "Keep this note" });
  });

  it.each(["Approve", "Decline", "Send counter-offer"])("locks synchronous duplicate and cross-row actions for %s", async (action) => {
    const post = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockResolvedValueOnce(response([row(), row("two")])).mockReturnValueOnce(post.promise)
      .mockResolvedValueOnce(response([]));
    render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one");
    for (const input of screen.getAllByLabelText(/Or propose a different amount/)) {
      fireEvent.change(input, { target: { value: "25" } });
    }
    const buttons = screen.getAllByRole("button", { name: action });
    // Native events in one batch exercise the ref lock before React commits disabled state.
    act(() => {
      buttons[0].click();
      buttons[0].click();
      buttons[1].click();
      screen.getAllByRole("button", { name: "Decline" })[1].click();
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(buttons[1].querySelector(".animate-spin")).toBeNull();
    expect(mocks.fetch.mock.calls[1][0]).toBe(`/api/client/approvals/one/${action === "Send counter-offer" ? "counter" : "respond"}`);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toEqual(action === "Send counter-offer"
      ? { amount: 25, expectedVersion: "a".repeat(64) } : { decision: action.toUpperCase(), expectedVersion: "a".repeat(64) });
    await act(async () => { post.resolve(response({})); });
    expect(await screen.findByText("All clear")).toBeVisible();
  });

  it.each(["user", "role", "impersonation"])("clears rows and drafts when %s changes and aborts stale GET", async (change) => {
    const oldRefresh = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockResolvedValueOnce(response([row()])).mockResolvedValueOnce(response({}))
      .mockReturnValueOnce(oldRefresh.promise).mockResolvedValueOnce(response([row()]));
    const view = render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one");
    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "Private draft" } });
    fireEvent.change(screen.getByLabelText(/Or propose a different amount/), { target: { value: "23" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    const signal = mocks.fetch.mock.calls[2][1].signal as AbortSignal;
    if (change === "user") identity("client-2");
    if (change === "role") identity("client-1", "VA");
    if (change === "impersonation") identity("client-1", "CLIENT", { actorId: "admin", mode: "WRITE", startedAt: "now" });
    view.rerender(<ClientApprovalsBoard />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByDisplayValue("Private draft")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("23")).not.toBeInTheDocument();
    await act(async () => { oldRefresh.resolve(response([row("private")])); });
    expect(screen.queryByText("Approval private")).not.toBeInTheDocument();
    if (change === "role") {
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(mocks.fetch).toHaveBeenCalledTimes(3);
    } else {
      expect(await screen.findByLabelText("Optional note")).toHaveValue("");
    }
  });

  it("ignores a submission completing after an identity change", async () => {
    const post = deferred<ReturnType<typeof response>>();
    mocks.fetch.mockResolvedValueOnce(response([row()])).mockReturnValueOnce(post.promise)
      .mockResolvedValueOnce(response([row("new")]));
    const view = render(<ClientApprovalsBoard />);
    await screen.findByText("Approval one");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    identity("client-2");
    view.rerender(<ClientApprovalsBoard />);
    await screen.findByText("Approval new");
    await act(async () => { post.resolve(response({})); });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });
});
