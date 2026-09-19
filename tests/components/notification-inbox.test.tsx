import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationInbox } from "@/components/v2/portal/notification-inbox";
import { emptyInboxState, nextInboxState } from "@/lib/notifications/inbox-state";

const auth = vi.hoisted(() => ({ status: "authenticated", user: { id: "alice", role: "CLIENT" }, impersonation: undefined as undefined | { actorId: string; mode: string; startedAt: number } }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: auth.status, data: { user: auth.user, impersonation: auth.impersonation } }) }));
const row = (overrides = {}) => ({ id: "one", subject: "Job updated", body: "Kitchen cleaning", createdAt: "2026-09-09T01:00:00Z", href: "/v2/client/jobs/job-1", ...overrides });
const response = (data: unknown) => ({ ok: true, json: async () => data });
const fetchMock = vi.fn();
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((done) => { resolve = done; });
  return { promise, resolve };
}
function open() { fireEvent.click(screen.getByRole("button", { name: "Recent notifications" })); }
beforeEach(() => {
  auth.status = "authenticated";
  auth.impersonation = undefined;
  auth.user = { id: "alice", role: "CLIENT" };
  fetchMock.mockReset().mockResolvedValue(response([row()]));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("notification inbox", () => {
  it("keeps a newer refresh when an older mutation acknowledgement arrives late", async () => {
    const pending = deferred(); const initial = emptyInboxState();
    const first = nextInboxState(initial, "NEEDS_ACTION"); const newer = nextInboxState(first, "ARCHIVE");
    fetchMock.mockResolvedValueOnce(response([row({ inboxState: initial })])).mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response([row({ inboxState: newer })]));
    render(<NotificationInbox accent="client" />); open(); fireEvent.click(await screen.findByRole("button", { name: "Needs action" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    await act(async () => pending.resolve(response({ state: first })));
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.change(screen.getByLabelText("Personal follow-up filter"), { target: { value: "ARCHIVED" } });
    expect(screen.getByText("Personal follow-up: Needs action · Archived")).toBeVisible();
  });
  it("persists explicit personal follow-up and archive only after confirmed responses", async () => {
    const state = emptyInboxState(); const needs = nextInboxState(state, "NEEDS_ACTION"); const resolved = nextInboxState(needs, "RESOLVE"); const archived = nextInboxState(resolved, "ARCHIVE");
    fetchMock.mockResolvedValueOnce(response([row({ inboxState: state })]))
      .mockResolvedValueOnce(response({ state: needs })).mockResolvedValueOnce(response({ state: resolved })).mockResolvedValueOnce(response({ state: archived }));
    render(<NotificationInbox accent="client" />); open();
    fireEvent.click(await screen.findByRole("button", { name: "Needs action" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resolve follow-up" }));
    await screen.findByText("Personal follow-up: Resolved");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    fireEvent.change(screen.getByLabelText("Personal follow-up filter"), { target: { value: "ARCHIVED" } });
    expect(screen.getByRole("link")).toBeVisible(); expect(screen.getByRole("button", { name: "Restore to inbox" })).toBeVisible();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ id: "one", revision: 1, action: "RESOLVE" });
  });
  it("rejects false acknowledgement and preserves the visible inbox row", async () => {
    fetchMock.mockResolvedValueOnce(response([row({ inboxState: emptyInboxState() })])).mockResolvedValueOnce(response({ state: { ...emptyInboxState(), revision: 1 } }));
    render(<NotificationInbox accent="client" />); open(); fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    await screen.findByText("Could not save follow-up. Refresh notifications before retrying."); expect(screen.getByRole("link")).toBeVisible();
  });
  it("does not expose follow-up mutations while impersonating", async () => {
    auth.impersonation = { actorId: "admin", mode: "INTERACTIVE", startedAt: 1 };
    fetchMock.mockResolvedValue(response([row({ inboxState: emptyInboxState() })]));
    render(<NotificationInbox accent="client" />); open(); await screen.findByRole("link");
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });
  it.each([401, 403])("clears rows and pagination on older-page denial %s", async status => {
    fetchMock.mockResolvedValueOnce(response({ items: [row()], nextCursor: "cursor_A" }))
      .mockResolvedValueOnce({ ok: false, status });
    render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Load older notifications" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load older notifications" })).toBeNull();
  });

  it("aborts older pages when identity changes and ignores their result", async () => {
    const pending = deferred();
    fetchMock.mockResolvedValueOnce(response({ items: [row()], nextCursor: "cursor_A" })).mockReturnValueOnce(pending.promise);
    const view = render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Load older notifications" }));
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    auth.user = { id: "bob", role: "CLIENT" };
    view.rerender(<NotificationInbox accent="client" />);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response({ items: [row({ subject: "Old identity" })], nextCursor: null })));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Old identity")).toBeNull();
  });

  it("loads older history and retries without losing rows", async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [row()], nextCursor: "cursor_A" }))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response({ items: [row(), row({ id: "two", subject: "Older update" })], nextCursor: null }));
    render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Load older notifications" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: /Job updated/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: /Older update/ });
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/notifications/log?paginated=1&lifecycle=1&cursor=cursor_A");
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[1][0]);
    expect(screen.queryByRole("button", { name: "Load older notifications" })).toBeNull();
  });

  it("can continue past a page containing no visible records", async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [], nextCursor: "cursor_A" }))
      .mockResolvedValueOnce(response({ items: [row()], nextCursor: null }));
    render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Load older notifications" }));
    expect(await screen.findByRole("link")).toBeVisible();
  });

  it("rejects a nonadvancing cursor and retains loaded history", async () => {
    fetchMock.mockResolvedValue(response({ items: [row()], nextCursor: "cursor_A" }));
    render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Load older notifications" }));
    await screen.findByRole("alert");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("loads only when opened and renders the returned destination and limited scope", async () => {
    render(<NotificationInbox accent="client" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveAttribute("title", "Recent notifications");
    open();
    expect(await screen.findByRole("link", { name: /Job updated/ })).toHaveAttribute("href", "/v2/client/jobs/job-1");
    expect(screen.getByText("Notification history")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/log?paginated=1&lifecycle=1", expect.objectContaining({ method: "GET", cache: "no-store", signal: expect.any(AbortSignal) }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "KITCHEN" } });
    expect(screen.getByRole("link")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No matching notifications in loaded history.");
  });

  it.each(["unauthenticated", "loading"])("does not fetch while %s", (status) => {
    auth.status = status;
    render(<NotificationInbox accent="client" />);
    act(() => window.dispatchEvent(new Event("sneek:notification")));
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows loading, retries an error, and refreshes empty results", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response([]));
    render(<NotificationInbox accent="client" />);
    open();
    expect(screen.getByRole("status")).toHaveTextContent("Loading notifications");
    await act(async () => pending.resolve({ ...response([]), ok: false }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh notifications");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No recent notifications.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    expect(await screen.findByRole("link")).toBeVisible();
  });

  it("rejects malformed responses and filters invalid, duplicate, and unsafe rows", async () => {
    fetchMock.mockResolvedValueOnce(response({ rows: [] })).mockResolvedValueOnce(response([
      row(), row(), null, row({ id: "bad-date", createdAt: "nonsense" }), row({ id: "bad-body", body: {} }),
      ...["https://evil.test", "//evil.test", "/\\evil.test", "/%2fevil.test", "/%5cevil.test", "/%0aevil", "javascript:alert(1)", "/%zz"].map((href) => row({ id: href, href })),
      row({ id: "laundry", subject: "Laundry ready", href: "/v2/laundry" }),
    ]));
    render(<NotificationInbox accent="client" />);
    open();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: /Laundry ready/ });
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Laundry ready/ })).toHaveAttribute("href", "/v2/laundry");
  });

  it("limits displayed results to 200", async () => {
    fetchMock.mockResolvedValue(response(Array.from({ length: 201 }, (_, id) => row({ id: String(id) }))));
    render(<NotificationInbox accent="client" />);
    open();
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(200));
  });

  it("coalesces SSE refreshes without overlap and stops on close", async () => {
    const first = deferred();
    const second = deferred();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<NotificationInbox accent="client" />);
    act(() => window.dispatchEvent(new Event("sneek:notification")));
    expect(fetchMock).not.toHaveBeenCalled();
    open();
    act(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new Event("sneek:notification")); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(response([row()])));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    expect(signal.aborted).toBe(true);
    act(() => window.dispatchEvent(new Event("sneek:notification")));
    await act(async () => second.resolve(response([row({ subject: "Stale" })])));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it.each(["account", "role", "logout", "impersonation"])("aborts and clears the inbox on %s change, ignoring stale results", async (change) => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(response([row({ subject: "New session" })]));
    const view = render(<NotificationInbox accent="client" />);
    open();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    if (change === "logout") auth.status = "unauthenticated";
    else if (change === "impersonation") auth.impersonation = { actorId: "admin", mode: "READ_ONLY", startedAt: 123 };
    else auth.user = change === "account" ? { id: "bob", role: "CLIENT" } : { id: "alice", role: "VA" };
    view.rerender(<NotificationInbox accent="client" />);
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => pending.resolve(response([row({ subject: "Old session" })])));
    expect(screen.queryByText("Old session")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (change !== "logout") {
      open();
      expect(await screen.findByRole("link", { name: /New session/ })).toBeVisible();
      expect(screen.queryByText("Old session")).toBeNull();
    }
  });

  it.each([401, 403])("clears private rows when refresh returns %s", async (status) => {
    render(<NotificationInbox accent="client" />);
    open();
    await screen.findByRole("link");
    fetchMock.mockResolvedValueOnce({ ok: false, status });
    fireEvent.click(screen.getByRole("button", { name: "Refresh notifications" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("traps keyboard focus, closes with Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    render(<NotificationInbox accent="client" />);
    const trigger = screen.getByRole("button", { name: "Recent notifications" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Recent notifications" });
    await within(dialog).findByRole("link");
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe("inbox read controls", () => {
  it("persists read status only after server confirmation and filters unread", async () => {
    const pending = deferred();
    fetchMock.mockResolvedValueOnce(response([row({ isRead: false })])).mockReturnValueOnce(pending.promise);
    render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
    expect(screen.getByText("Unread")).toBeVisible();
    expect(fetchMock.mock.calls[1]).toEqual(["/api/notifications/log", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ ids: ["one"] }) })]);
    await act(async () => pending.resolve(response({ ok: true, updated: 1 })));
    expect(screen.getByText("Read")).toBeVisible();
    fireEvent.click(screen.getByRole("checkbox", { name: "Unread only (loaded history)" }));
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("retains unread state on write failure and allows retry", async () => {
    fetchMock.mockResolvedValueOnce(response([row({ isRead: false })])).mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(response({ ok: true, updated: 1 }));
    render(<NotificationInbox accent="client" />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Unread")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(await screen.findByText("Read")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not offer read mutations while impersonating", async () => {
    auth.impersonation = { actorId: "admin", mode: "INTERACTIVE", startedAt: 10 };
    render(<NotificationInbox accent="client" />);
    open();
    await screen.findByRole("link");
    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
  });
});

it("keeps confirmed read state when an older in-flight refresh returns", async () => {
  const refresh = deferred();
  fetchMock.mockResolvedValueOnce(response([row({ isRead: false })]))
    .mockResolvedValueOnce(response({ ok: true, updated: 1 }))
    .mockReturnValueOnce(refresh.promise);
  render(<NotificationInbox accent="client" />);
  open();
  const mark = await screen.findByRole("button", { name: "Mark as read" });
  fireEvent.click(mark);
  act(() => window.dispatchEvent(new CustomEvent("sneek:notification")));
  await screen.findByText("Read");
  await act(async () => refresh.resolve(response([row({ isRead: false })])));
  expect(screen.getByText("Read")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
});

it("does not claim success when the recipient record was removed", async () => {
  fetchMock.mockResolvedValueOnce(response([row({ isRead: false })])).mockResolvedValueOnce(response({ ok: true, updated: 0 }));
  render(<NotificationInbox accent="client" />);
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Mark as read" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Unread")).toBeVisible();
});

describe("notification snooze", () => {
  it("snoozes by explicit duration and ends snooze without changing follow-up or read", async () => {
    const initial = { ...emptyInboxState(), followUp: "NEEDS_ACTION" as const };
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== "PATCH") return response([row({ inboxState: initial, isRead: false })]);
      const input = JSON.parse(init.body);
      const current = input.revision === 0 ? initial : { ...initial, revision: 1, snoozedUntil: new Date(Date.now() + 3600000).toISOString() };
      return response({ state: nextInboxState(current, input.action, input.snoozedUntil) });
    });
    render(<NotificationInbox accent="client" />); open();
    fireEvent.click(await screen.findByRole("button", { name: "Snooze 1 hour" }));
    await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    const patch = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH"); const input = JSON.parse(patch![1].body);
    expect(Date.parse(input.snoozedUntil) - Date.now()).toBeGreaterThan(3500000);
    fireEvent.change(screen.getByLabelText("Personal follow-up filter"), { target: { value: "SNOOZED" } });
    expect(screen.getByText("Personal follow-up: Needs action")).toBeVisible(); expect(screen.getByText("Unread")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "End snooze" })); await waitFor(() => expect(screen.queryByRole("link")).toBeNull());
    fireEvent.change(screen.getByLabelText("Personal follow-up filter"), { target: { value: "NEEDS_ACTION" } }); expect(screen.getByRole("link")).toBeVisible();
  });
  it("expired snoozes return on the clock without a write or refresh", async () => {
    vi.useFakeTimers();
    try {
      const until = new Date(Date.now() + 2000).toISOString();
      fetchMock.mockResolvedValue(response([row({ inboxState: { ...emptyInboxState(), snoozedUntil: until } })]));
      render(<NotificationInbox accent="client" />); open(); await act(async () => { await Promise.resolve(); });
      expect(screen.queryByRole("link")).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); expect(screen.getByRole("link")).toBeVisible();
      expect(fetchMock.mock.calls.every(call => call[1]?.method === "GET")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("does not hide an item when snooze save fails or acknowledgement differs", async () => {
    fetchMock.mockResolvedValueOnce(response([row({ inboxState: emptyInboxState() })])).mockResolvedValueOnce(response({ state: { ...emptyInboxState(), revision: 1 } }));
    render(<NotificationInbox accent="client" />); open(); fireEvent.click(await screen.findByRole("button", { name: "Snooze 24 hours" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save follow-up"); expect(screen.getByRole("link")).toBeVisible();
  });
});

describe("notification lifecycle details", () => {
  it("separates dispatch, device evidence, read and acknowledgement", async () => {
    fetchMock.mockResolvedValue(response([row({ inboxState: { ...emptyInboxState(), followUp: "RESOLVED" }, lifecycle: { dispatch: "INBOX_AVAILABLE", provider: "NOT_RECORDED", personalRead: "UNREAD", acknowledgement: "NOT_RECORDED" } })]));
    render(<NotificationInbox accent="client" />); open(); await screen.findByText("Delivery details"); fireEvent.click(screen.getByText("Delivery details"));
    expect(screen.getByText("Available in your inbox")).toBeVisible(); expect(screen.getByText("No provider delivery evidence recorded")).toBeVisible(); expect(screen.getByText(/Acknowledgement: not recorded/)).toBeVisible(); expect(screen.getByText("Personal follow-up: Resolved")).toBeVisible();
  });
  it("rejects malformed lifecycle data rather than presenting invented success", async () => {
    fetchMock.mockResolvedValue(response([row({ lifecycle: { provider: "DELIVERED" } })])); render(<NotificationInbox accent="client" />); open(); await screen.findByText("No recent notifications."); expect(screen.queryByRole("link")).toBeNull();
  });
});

it("acknowledgement requires explicit action and does not mark read or resolve follow-up", async () => {
  const initial = { ...emptyInboxState(), followUp: "NEEDS_ACTION" as const };
  fetchMock.mockResolvedValueOnce(response([row({ inboxState: initial, isRead: false, lifecycle: { dispatch: "INBOX_AVAILABLE", provider: "NOT_RECORDED", personalRead: "UNREAD", acknowledgement: "NOT_RECORDED" } })])).mockResolvedValueOnce(response({ state: nextInboxState(initial, "ACKNOWLEDGE") }));
  render(<NotificationInbox accent="client" />); open(); const button = await screen.findByRole("button", { name: "Acknowledge notification" });
  expect(fetchMock).toHaveBeenCalledTimes(1); fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Acknowledge notification" })).toBeNull());
  expect(screen.getByText("Unread")).toBeVisible(); expect(screen.getByText("Personal follow-up: Needs action")).toBeVisible(); expect(screen.getByText(/Acknowledged/)).toBeVisible();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: "one", revision: 0, action: "ACKNOWLEDGE" });
});
it("does not invent acknowledgement if mutation response lacks it", async () => {
  fetchMock.mockResolvedValueOnce(response([row({ inboxState: emptyInboxState() })])).mockResolvedValueOnce(response({ state: { ...emptyInboxState(), revision: 1 } }));
  render(<NotificationInbox accent="client" />); open(); fireEvent.click(await screen.findByRole("button", { name: "Acknowledge notification" })); expect(await screen.findByRole("alert")).toHaveTextContent("Could not save follow-up"); expect(screen.getByRole("button", { name: "Acknowledge notification" })).toBeVisible();
});
