import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveNotifications, NOTIFICATION_EVENT } from "@/components/shared/live-notifications";

const mocks = vi.hoisted(() => ({ session: vi.fn(), toast: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

class Stream {
  static instances: Stream[] = [];
  listener?: (event: MessageEvent<string>) => void;
  onerror = null;
  close = vi.fn();
  removeEventListener = vi.fn();
  constructor(public url: string) { Stream.instances.push(this); }
  addEventListener(_type: string, listener: Stream["listener"]) { this.listener = listener; }
  emit(value: unknown) { this.listener?.({ data: JSON.stringify(value) } as MessageEvent<string>); }
}

class BrowserNotification {
  static permission = "default";
  static requestPermission = vi.fn();
  static instances: BrowserNotification[] = [];
  onclick?: () => void;
  close = vi.fn();
  constructor() { BrowserNotification.instances.push(this); }
}

const item = (id = "new", href = "/v2/client") => ({ id, href, subject: "Update", body: "Ready", jobId: null });
const session = (id = "one", role = "CLIENT", impersonation?: object) => ({
  status: "authenticated", data: { user: { id, role }, impersonation },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}
const connected = async (count = 1) => {
  await waitFor(() => expect(Stream.instances).toHaveLength(count));
  return Stream.instances[count - 1];
};

beforeEach(() => {
  vi.clearAllMocks();
  Stream.instances = [];
  BrowserNotification.instances = [];
  BrowserNotification.permission = "default";
  mocks.session.mockReturnValue(session());
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json([]))));
  vi.stubGlobal("EventSource", Stream);
  vi.stubGlobal("Notification", BrowserNotification);
  vi.stubGlobal("navigator", Object.defineProperty(Object.create(navigator), "webdriver", { value: false, configurable: true }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("LiveNotifications", () => {
  it.each([
    session("two"), session("one", "ADMIN"),
    session("one", "CLIENT", { actorId: "admin", mode: "READ_ONLY", startedAt: 1 }),
  ])("resets deduplication and closes stale streams on identity changes: %j", async (next) => {
    const view = render(<LiveNotifications />);
    const old = await connected();
    act(() => old.emit(item()));
    mocks.session.mockReturnValue(next);
    view.rerender(<LiveNotifications />);
    const current = await connected(2);
    expect(old.close).toHaveBeenCalledOnce();
    expect(old.removeEventListener).toHaveBeenCalledWith("notification", old.listener);
    act(() => { old.emit(item("stale")); current.emit(item()); current.emit(item()); });
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  it.each(["account", "role", "unmount"])("aborts a pending prime on %s and ignores its late body", async (change) => {
    const body = deferred<unknown>();
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: () => body.promise } as Response);
    const view = render(<LiveNotifications />);
    await act(async () => {});
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    if (change === "unmount") view.unmount();
    else {
      mocks.session.mockReturnValue(change === "account" ? session("two") : session("one", "ADMIN"));
      view.rerender(<LiveNotifications />);
      await connected();
    }
    expect(signal?.aborted).toBe(true);
    await act(async () => { body.resolve([item("late")]); });
    expect(Stream.instances).toHaveLength(change === "unmount" ? 0 : 1);
    if (change !== "unmount") {
      act(() => Stream.instances[0].emit(item("late")));
      expect(mocks.toast).toHaveBeenCalledOnce();
    }
    expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("ignores a fetch resolving after logout and never requests permission", async () => {
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(pending.promise);
    const view = render(<LiveNotifications />);
    mocks.session.mockReturnValue({ status: "unauthenticated", data: null });
    view.rerender(<LiveNotifications />);
    await act(async () => pending.resolve(Response.json([item()])));
    expect(Stream.instances).toHaveLength(0);
    expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("primes history, deduplicates live items, and ignores malformed rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json([item("history"), { id: "new", subject: 3 }, null]));
    const event = vi.fn();
    window.addEventListener(NOTIFICATION_EVENT, event);
    try {
      render(<LiveNotifications />);
      const stream = await connected();
      act(() => {
        for (const row of [null, [], {}, { ...item(), subject: 4 }, { ...item(), jobId: {} }, { ...item(), body: 2 }, { ...item(), href: null }, item(" ")]) stream.emit(row);
        stream.listener?.({ data: "invalid JSON" } as MessageEvent<string>);
        stream.emit(item("history"));
        stream.emit(item());
        stream.emit(item());
      });
      expect(mocks.toast).toHaveBeenCalledOnce();
      expect(event).toHaveBeenCalledOnce();
      expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
    } finally { window.removeEventListener(NOTIFICATION_EVENT, event); }
  });

  it("bounds remembered IDs and connects when priming fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    render(<LiveNotifications />);
    const stream = await connected();
    act(() => {
      for (let i = 0; i <= 1000; i++) stream.emit(item(String(i)));
      stream.emit(item("1000"));
      stream.emit(item("0"));
    });
    expect(mocks.toast).toHaveBeenCalledTimes(1002);
  });

  it("cleans up on unmount and ignores queued events and notification clicks", async () => {
    BrowserNotification.permission = "granted";
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const view = render(<LiveNotifications />);
    const stream = await connected();
    act(() => stream.emit(item()));
    view.unmount();
    act(() => { stream.emit(item("late")); BrowserNotification.instances[0].onclick?.(); });
    expect(stream.close).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
  });

  it.each(["/v2/client?tab=jobs#new", "https://evil.example", "//evil.example", "/a/..//evil.example", "/\\evil.example", "javascript:alert(1)", "/\n/evil.example"])("validates browser notification navigation: %j", async (href) => {
    BrowserNotification.permission = "granted";
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.spyOn(window, "focus").mockImplementation(() => {});
    const assign = vi.fn();
    render(<LiveNotifications />);
    const stream = await connected();
    act(() => stream.emit(item("new", href)));
    vi.stubGlobal("window", { location: { origin: "http://localhost:3000", assign }, focus: vi.fn() });
    BrowserNotification.instances[0].onclick?.();
    if (href === "/v2/client?tab=jobs#new") expect(assign).toHaveBeenCalledWith(href);
    else expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("preserves webdriver stream suppression", async () => {
    Object.defineProperty(navigator, "webdriver", { value: true });
    render(<LiveNotifications />);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledOnce();
    expect(Stream.instances).toHaveLength(0);
    expect(BrowserNotification.requestPermission).not.toHaveBeenCalled();
  });
});
