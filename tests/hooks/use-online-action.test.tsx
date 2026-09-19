import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOnlineAction } from "@/hooks/use-online-action";
import { UnknownActionOutcome } from "@/lib/cleaner/online-action";
beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps malformed legacy markers blocked instead of assuming no dispatch", async () => {
  sessionStorage.setItem("cleaner-action-pending:scope", JSON.stringify({ label: "Pause", requestId: crypto.randomUUID() }));
  const { result } = renderHook(() => useOnlineAction("scope"));
  expect(result.current.blocked).toBe(true);
  const read = vi.fn();
  await expect(result.current.reconcile(read)).rejects.toThrow("cannot be verified");
  expect(read).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("cleaner-action-pending:scope")).not.toBeNull();
});
it("requires a valid server fence before clearing a dispatched unknown outcome", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("lost response"));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useOnlineAction("scope"));
  act(() => result.current.begin("Pause"));
  let error: unknown;
  try { await result.current.post("/api/cleaner/jobs/job/stop", {}, "a".repeat(64)); } catch (caught) { error = caught; }
  act(() => result.current.finish(error));
  const marker = JSON.parse(sessionStorage.getItem("cleaner-action-pending:scope")!);
  expect(marker).toMatchObject({ phase: "DISPATCHED", action: "stop", input: {}, identity: "a".repeat(64) });
  const read = vi.fn(async () => {});
  fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, state: "COMMITTED", result: { status: 200, body: {} } }) });
  await act(async () => { await expect(result.current.reconcile(read)).rejects.toThrow("not confirmed"); });
  expect(read).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("cleaner-action-pending:scope")).not.toBeNull();
  fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, state: "CANCELLED", result: { status: 409, body: { error: "cancelled" } } }) });
  await act(async () => { await result.current.reconcile(read); });
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ requestId: marker.requestId, action: "stop", input: {} });
  expect(read).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem("cleaner-action-pending:scope")).toBeNull();
});
it("writes the marker before dispatch and rejects a same-tick duplicate", () => {
  const { result } = renderHook(() => useOnlineAction("scope"));
  act(() => result.current.begin("Pause"));
  expect(JSON.parse(sessionStorage.getItem("cleaner-action-pending:scope")!).label).toBe("Pause");
  expect(() => result.current.begin("Pause")).toThrow("already");
  act(() => result.current.finish());
  expect(sessionStorage.getItem("cleaner-action-pending:scope")).toBeNull();
});
it("fails before dispatch if recovery storage cannot retain the marker", () => {
  const { result } = renderHook(() => useOnlineAction("scope"));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(() => result.current.begin("Start")).toThrow("storage");
});
it("does not clear uncertainty on reconnect or failed read", async () => {
  const { result } = renderHook(() => useOnlineAction("scope"));
  act(() => { result.current.begin("Start"); result.current.finish(new UnknownActionOutcome()); });
  act(() => window.dispatchEvent(new Event("online")));
  expect(result.current.uncertain).toBe("Start");
  await act(async () => { await expect(result.current.reconcile(async () => { throw new Error("offline"); })).rejects.toThrow("offline"); });
  expect(result.current.uncertain).toBe("Start");
  expect(() => result.current.begin("Pause")).toThrow("latest");
  await act(async () => result.current.reconcile(async () => {}));
  expect(result.current.uncertain).toBeNull();
});
it("never exposes another scope's marker or lets its late completion clear the current action", () => {
  const { result, rerender } = renderHook(({ scope }) => useOnlineAction(scope), { initialProps: { scope: "one" } });
  const old = result.current;
  act(() => old.begin("Old action"));
  rerender({ scope: "two" });
  expect(result.current.uncertain).toBeNull();
  act(() => result.current.begin("New action"));
  act(() => old.finish());
  expect(JSON.parse(sessionStorage.getItem("cleaner-action-pending:two")!).label).toBe("New action");
  expect(JSON.parse(sessionStorage.getItem("cleaner-action-pending:one")!).label).toBe("Old action");
});
