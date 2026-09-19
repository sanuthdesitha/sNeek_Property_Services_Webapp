import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftSave } from "@/lib/cleaner/use-draft-save";
import { readDraftStatus } from "@/lib/cleaner/draft-status-snapshot";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ack = () => new Response(JSON.stringify({ ok: true, updatedAt: "2026-09-09T10:00:00Z" }));
let requests: ReturnType<typeof deferred<Response>>[];
let fetchMock: ReturnType<typeof vi.fn>;
const tick = async () => { await act(async () => { await Promise.resolve(); }); };
async function reply(index: number, response = ack()) {
  await act(async () => { requests[index].resolve(response); });
}

beforeEach(() => {
  requests = [];
  fetchMock = vi.fn(() => {
    const request = deferred<Response>(); requests.push(request); return request.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("useDraftSave with the real save client", () => {
  it("retains unconfirmed save status across navigation instead of accepting a late unmounted acknowledgement", async () => {
    const identity = "snapshot-unmount";
    const { result, unmount } = renderHook(() => useDraftSave(identity));
    act(() => { void result.current.save("job", "editor", {}); });
    await tick();
    expect(readDraftStatus(identity)?.phase).toBe("saving");
    unmount(); await reply(0);
    expect(readDraftStatus(identity)?.phase).toBe("saving");
    expect(readDraftStatus("another-identity")).toBeNull();
  });
  it("publishes only the newest acknowledgement and clears it on explicit reset", async () => {
    const identity = "snapshot-revision";
    const { result } = renderHook(() => useDraftSave(identity));
    act(() => { void result.current.save("job", "editor", {}); }); await tick();
    act(() => result.current.markDirty()); await reply(0);
    expect(readDraftStatus(identity)?.phase).toBe("saving");
    act(() => { void result.current.save("job", "editor", {}); }); await tick(); await reply(1);
    expect(readDraftStatus(identity)?.phase).toBe("saved");
    act(() => result.current.reset()); expect(readDraftStatus(identity)).toBeNull();
  });
  it("sends immutable snapshots FIFO and confirms only the latest save", async () => {
    const { result } = renderHook(useDraftSave);
    const draft = { answers: { note: "first" } };
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.save("job", "editor-a", draft);
      draft.answers.note = "second";
      second = result.current.save("job", "editor-b", draft, true);
      draft.answers.note = "unsent";
    });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).state.answers.note).toBe("first");
    await reply(0); await first;
    expect(result.current.state.phase).toBe("saving");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ keepalive: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ editorSessionId: "editor-b", state: { answers: { note: "second" } } });
    await reply(1); await second;
    expect(result.current.state.phase).toBe("saved");
  });

  it.each([true, false])("markDirty invalidates a running acknowledgement (success=%s) before debounce", async (success) => {
    vi.useFakeTimers();
    const { result } = renderHook(useDraftSave);
    act(() => { void result.current.save("job", "editor", { old: true }); });
    await tick();
    act(() => {
      result.current.markDirty();
      setTimeout(() => { void result.current.save("job", "editor", { latest: true }); }, 1500);
    });
    await reply(0, success ? ack() : new Response(null, { status: 503 }));
    expect(result.current.state.phase).toBe("saving");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await reply(1);
    expect(result.current.state.phase).toBe("saved");
    act(() => result.current.markDirty());
    expect(result.current.state.phase).toBe("saving");
  });

  it("invalidates queued acknowledgements without discarding their snapshots", async () => {
    const { result } = renderHook(useDraftSave);
    act(() => {
      void result.current.save("job", "editor", { version: 1 });
      void result.current.save("job", "editor", { version: 2 });
      result.current.markDirty();
    });
    await tick(); await reply(0); await reply(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.state.phase).toBe("saving");
  });

  it.each([401, 403, 409, 503])("exposes HTTP %s errors and permits an explicit retry", async (status) => {
    const { result } = renderHook(useDraftSave);
    act(() => { void result.current.save("job", "editor", {}); });
    await tick(); await reply(0, new Response(null, { status }));
    expect(result.current.state).toMatchObject({ phase: "error", message: expect.stringContaining("Draft not saved") });
    act(() => { void result.current.save("job", "editor", {}); });
    expect(result.current.state.phase).toBe("saving");
    await tick(); await reply(1);
    expect(result.current.state.phase).toBe("saved");
  });

  it("reports network uncertainty without claiming server rollback", async () => {
    const { result } = renderHook(useDraftSave);
    act(() => { void result.current.save("job", "editor", {}); });
    await tick();
    await act(async () => { requests[0].reject(new Error("private diagnostics")); });
    expect(result.current.state).toEqual({ phase: "error", message: "Draft save could not be confirmed. Keep this page open and retry." });
    act(() => { void result.current.save("job", "editor", {}); });
    await tick(); await reply(1);
    expect(result.current.state.phase).toBe("saved");
  });

  it.each([true, false])("reset drops queued work and ignores running completion (success=%s)", async (success) => {
    const { result } = renderHook(useDraftSave);
    let queued!: Promise<void>;
    act(() => {
      void result.current.save("old-job", "editor", { version: 1 });
      queued = result.current.save("old-job", "editor", { version: 2 });
    });
    await tick();
    act(() => result.current.reset());
    expect(result.current.state.phase).toBe("idle");
    await reply(0, success ? ack() : new Response(null, { status: 409 }));
    await queued;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe("idle");
  });

  it("new saves after reset still wait for the already-running request", async () => {
    const { result } = renderHook(useDraftSave);
    act(() => { void result.current.save("old-job", "editor", {}); });
    await tick();
    act(() => {
      result.current.reset();
      void result.current.save("new-job", "new-editor", {});
    });
    await tick(); expect(fetchMock).toHaveBeenCalledTimes(1);
    await reply(0);
    expect(result.current.state.phase).toBe("saving");
    expect(fetchMock.mock.calls[1][0]).toContain("/new-job/draft");
    await reply(1); expect(result.current.state.phase).toBe("saved");
  });

  it("reset before dispatch suppresses all queued requests", async () => {
    const { result } = renderHook(useDraftSave);
    let completion!: Promise<void>;
    act(() => { completion = result.current.save("job", "editor", {}); result.current.reset(); });
    await act(async () => { await completion; });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe("idle");
  });

  it("unmount suppresses queued requests, completions, and retained callbacks", async () => {
    const { result, unmount } = renderHook(useDraftSave);
    const api = result.current;
    let queued!: Promise<void>;
    act(() => {
      void api.save("job", "editor", {});
      queued = api.save("job", "editor", { second: true });
    });
    await tick(); unmount();
    await reply(0); await queued;
    await api.save("job", "editor", { third: true }); api.markDirty(); api.reset();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("works after StrictMode effect replay and keeps callbacks stable", async () => {
    const { result, rerender } = renderHook(useDraftSave, {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    const api = result.current;
    rerender();
    expect(result.current.save).toBe(api.save);
    expect(result.current.reset).toBe(api.reset);
    expect(result.current.markDirty).toBe(api.markDirty);
    act(() => { void api.save("job", "editor", {}); });
    await tick(); await reply(0);
    expect(result.current.state.phase).toBe("saved");
  });

  it("snapshot failures are safe and do not break the queue", async () => {
    const { result } = renderHook(useDraftSave);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    await act(async () => { await result.current.save("job", "editor", circular); });
    expect(result.current.state.phase).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => { void result.current.save("job", "editor", {}); });
    await tick(); await reply(0);
    expect(result.current.state.phase).toBe("saved");
  });
});
