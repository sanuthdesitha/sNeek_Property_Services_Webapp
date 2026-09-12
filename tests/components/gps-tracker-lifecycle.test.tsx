import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGpsTracker } from "@/lib/gps/client";
import type { QueuedPing } from "@/lib/gps/queue";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), enqueue: vi.fn(), drain: vi.fn(), clear: vi.fn(),
}));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));
vi.mock("@/lib/gps/queue", () => ({
  enqueuePing: mocks.enqueue, drainQueue: mocks.drain, clearQueue: mocks.clear,
}));

const signedIn = (id = "one", impersonation?: { actorId: string; mode: string; startedAt: number }) => ({
  status: "authenticated", data: { user: { id, role: "CLEANER" }, impersonation },
});
const scope = (id = "one") => JSON.stringify([id, "CLEANER", null, null, null]);
const ping = (id: string, owner: string | undefined = scope(), jobId = "previous-job"): QueuedPing => ({
  id, scope: owner, jobId, lat: 1, lng: 2, timestamp: "2026-09-09T00:00:00.000Z",
});
const position = { coords: { latitude: 1, longitude: 2, accuracy: 5, heading: null, speed: null } } as GeolocationPosition;
const denied = { code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError;
let oneShots: PositionCallback[];
let watches: PositionCallback[];
let errors: PositionErrorCallback[];
let geo: { getCurrentPosition: ReturnType<typeof vi.fn>; watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn> };
let fetcher: ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { await act(async () => {}); }
async function online() { await act(async () => { window.dispatchEvent(new Event("online")); }); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T00:00:00Z"));
  vi.resetAllMocks();
  mocks.session.mockReturnValue(signedIn());
  mocks.enqueue.mockResolvedValue(undefined);
  mocks.drain.mockResolvedValue([]);
  mocks.clear.mockResolvedValue(undefined);
  oneShots = []; watches = []; errors = [];
  geo = {
    getCurrentPosition: vi.fn((success: PositionCallback) => { oneShots.push(success); }),
    watchPosition: vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
      watches.push(success); errors.push(error); return watches.length;
    }),
    clearWatch: vi.fn(),
  };
  vi.stubGlobal("navigator", { geolocation: geo, onLine: true });
  fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("GPS collection lifecycle", () => {
  it.each(["disabled", "loading", "unauthenticated", "admin", "missing-id", "missing-job"])("does not collect or flush when %s", async mode => {
    if (mode === "loading" || mode === "unauthenticated") mocks.session.mockReturnValue({ status: mode, data: null });
    if (mode === "admin") mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "one", role: "ADMIN" } } });
    if (mode === "missing-id") mocks.session.mockReturnValue({ status: "authenticated", data: { user: { role: "CLEANER" } } });
    renderHook(() => useGpsTracker({ jobId: mode === "missing-job" ? "" : "job", enabled: mode !== "disabled" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    await online();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["disable", "logout", "unmount"])("ignores late one-shot, watch and errors after %s", async change => {
    const hook = renderHook(({ enabled }) => useGpsTracker({ jobId: "job", enabled }), { initialProps: { enabled: true } });
    await settle();
    if (change === "disable") hook.rerender({ enabled: false });
    if (change === "logout") { mocks.session.mockReturnValue({ status: "unauthenticated", data: null }); hook.rerender({ enabled: true }); }
    if (change === "unmount") hook.unmount();
    await act(async () => { oneShots[0](position); watches[0](position); errors[0](denied); });
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(hook.result.current.lastFix).toBeNull();
    expect(hook.result.current.permission).toBe("prompt");
  });

  it("resets coordinates on job switch and needs a fresh fix before heartbeat", async () => {
    const { result, rerender } = renderHook(({ jobId }) => useGpsTracker({ jobId }), { initialProps: { jobId: "first" } });
    await act(async () => oneShots[0](position));
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ jobId: "first", scope: scope() }));
    rerender({ jobId: "second" });
    expect(result.current.lastFix).toBeNull();
    await act(async () => { watches[0](position); oneShots[0](position); await vi.advanceTimersByTimeAsync(90_000); });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    await act(async () => watches[1](position));
    expect(mocks.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ jobId: "second" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(mocks.enqueue).toHaveBeenCalledTimes(3);
  });

  it("resets on enable and account/impersonation changes without logging coordinates", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const { result, rerender } = renderHook(({ enabled }) => useGpsTracker({ jobId: "job", enabled }), { initialProps: { enabled: true } });
    await act(async () => watches[0](position));
    rerender({ enabled: false }); rerender({ enabled: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    mocks.session.mockReturnValue(signedIn("two", { actorId: "admin", mode: "FULL", startedAt: 1 }));
    rerender({ enabled: true });
    expect(result.current.lastFix).toBeNull();
    await act(async () => { watches[1](position); oneShots[2](position); });
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ scope: JSON.stringify(["two", "CLEANER", "admin", "FULL", 1]) }));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("GPS owned queue flushing", () => {
  it("sends only current scope across jobs in batches of 50 without local metadata", async () => {
    const owned = Array.from({ length: 51 }, (_, i) => ping(`owned-${i}`, scope(), i % 2 ? "old-job" : "job"));
    mocks.drain.mockResolvedValue([ping("other", scope("two")), { ...ping("legacy"), scope: undefined }, ...owned]);
    renderHook(() => useGpsTracker({ jobId: "job" }));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const bodies = fetcher.mock.calls.map(call => JSON.parse(call[1].body));
    expect(bodies.map(body => body.length)).toEqual([50, 1]);
    expect(bodies.flat()).toEqual(owned.map(({ id: _id, scope: _scope, ...rest }) => rest));
    expect(mocks.clear.mock.calls.flatMap(call => call[0])).toEqual(owned.map(p => p.id));
  });

  it.each([401, 403, 429, 500])("stops on %i retaining all queued data", async status => {
    mocks.drain.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ping(String(i))));
    fetcher.mockResolvedValue({ ok: false, status });
    renderHook(() => useGpsTracker({ jobId: "job" }));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it.each([400, 422])("clears only the current permanently invalid batch on %i", async status => {
    mocks.drain.mockResolvedValue([ping("other", scope("two")), ping("invalid")]);
    fetcher.mockResolvedValue({ ok: false, status });
    renderHook(() => useGpsTracker({ jobId: "job" }));
    await settle();
    expect(mocks.clear.mock.calls).toEqual([[["invalid"]]]);
  });

  it("serializes reconnect/timer flushes through queue reads and network requests", async () => {
    const read = deferred<QueuedPing[]>();
    const request = deferred<{ ok: boolean; status: number }>();
    mocks.drain.mockReturnValue(read.promise);
    fetcher.mockReturnValue(request.promise);
    renderHook(() => useGpsTracker({ jobId: "job" }));
    await online();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.drain).toHaveBeenCalledTimes(1);
    await act(async () => read.resolve([ping("one")]));
    await online();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ ok: true, status: 200 }));
    expect(mocks.clear.mock.calls).toEqual([[["one"]]]);
  });

  it("ignores a late queue read after cleanup", async () => {
    const read = deferred<QueuedPing[]>();
    mocks.drain.mockReturnValue(read.promise);
    const { unmount } = renderHook(() => useGpsTracker({ jobId: "job" }));
    unmount();
    await act(async () => read.resolve([ping("old")]));
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it.each([200, 400])("aborts an old account request and ignores its late %i response", async status => {
    const request = deferred<{ ok: boolean; status: number }>();
    mocks.drain.mockResolvedValue([ping("old"), ping("new", scope("two"))]);
    fetcher.mockReturnValueOnce(request.promise);
    const { rerender } = renderHook(() => useGpsTracker({ jobId: "job" }));
    await settle();
    const signal = fetcher.mock.calls[0][1].signal;
    mocks.session.mockReturnValue(signedIn("two")); rerender();
    expect(signal.aborted).toBe(true);
    await online();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => request.resolve({ ok: status === 200, status }));
    expect(mocks.clear).not.toHaveBeenCalled();
    await online();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mocks.clear.mock.calls).toEqual([[["new"]]]);
  });

  it("retains offline records for the appropriate owner", async () => {
    vi.stubGlobal("navigator", { geolocation: geo, onLine: false });
    mocks.drain.mockResolvedValue([ping("old"), ping("other", scope("two"))]);
    renderHook(() => useGpsTracker({ jobId: "job" }));
    await settle();
    expect(mocks.drain).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { geolocation: geo, onLine: true });
    await online();
    expect(mocks.clear.mock.calls).toEqual([[["old"]]]);
  });

  it.each(["disable", "job", "unmount"])("aborts in-flight flushing on %s and retains its batch", async change => {
    const request = deferred<{ ok: boolean; status: number }>();
    mocks.drain.mockResolvedValue([ping("old")]);
    fetcher.mockReturnValue(request.promise);
    const hook = renderHook(props => useGpsTracker(props), { initialProps: { jobId: "job", enabled: true } });
    await settle();
    const signal = fetcher.mock.calls[0][1].signal;
    if (change === "disable") hook.rerender({ jobId: "job", enabled: false });
    if (change === "job") hook.rerender({ jobId: "next", enabled: true });
    if (change === "unmount") hook.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => request.resolve({ ok: true, status: 200 }));
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("isolates impersonation sessions even for the same cleaner", async () => {
    const impersonation = { actorId: "admin", mode: "FULL", startedAt: 2 };
    const currentScope = JSON.stringify(["one", "CLEANER", "admin", "FULL", 2]);
    mocks.session.mockReturnValue(signedIn("one", impersonation));
    mocks.drain.mockResolvedValue([
      ping("normal"),
      ping("previous-impersonation", JSON.stringify(["one", "CLEANER", "admin", "FULL", 1])),
      ping("current", currentScope),
    ]);
    renderHook(() => useGpsTracker({ jobId: "job" }));
    await settle();
    expect(mocks.clear.mock.calls).toEqual([[["current"]]]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toHaveLength(1);
  });
});
