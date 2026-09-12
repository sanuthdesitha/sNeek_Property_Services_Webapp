import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useJobsScrollRestoration } from "@/components/v2/admin/jobs/use-jobs-scroll-restoration";
import { JOBS_SCROLL_STORAGE_KEY, JOBS_SCROLL_MAX_AGE, readJobsScrollPositions } from "@/lib/jobs/scroll-restoration";
let frames: Map<number, FrameRequestCallback>;
let index: number;
const scroll = vi.fn();
const props = { context: "actor-effective-session", viewKey: "filters:all;view:list", contentKey: "jobs-one-two", ready: true };
function seed(overrides = {}) {
  window.sessionStorage.setItem(JOBS_SCROLL_STORAGE_KEY, JSON.stringify([{ scope: JSON.stringify([props.context, props.viewKey]), content: props.contentKey, x: 0, y: 750, width: window.innerWidth, height: window.innerHeight, savedAt: Date.now(), ...overrides }]));
}
function flush() { act(() => { for (let turn = 0; turn < 2; turn++) { const batch = Array.from(frames.values()); frames.clear(); batch.forEach(callback => callback(1)); } }); }
beforeEach(() => {
  frames = new Map(); index = 0; scroll.mockReset(); window.sessionStorage.clear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++index, callback); return index; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(window, "scrollTo").mockImplementation(scroll);
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  Object.defineProperty(document.documentElement, "scrollWidth", { configurable: true, value: window.innerWidth });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
});
afterEach(() => vi.restoreAllMocks());
it("waits for the matching data and layout before exact restoration", () => {
  seed();
  const view = renderHook(value => useJobsScrollRestoration(value), { initialProps: { ...props, ready: false } });
  flush(); expect(scroll).not.toHaveBeenCalled();
  view.rerender(props); flush();
  expect(scroll).toHaveBeenCalledWith({ left: 0, top: 750, behavior: "instant" });
});
it.each([
  { context: "other-account" }, { viewKey: "filters:client-b;view:list" }, { viewKey: "filters:all;view:board" }, { contentKey: "different-jobs" },
])("does not apply positions from another scope or result: %j", changes => {
  seed(); renderHook(() => useJobsScrollRestoration({ ...props, ...changes })); flush(); expect(scroll).not.toHaveBeenCalled();
});
it.each([{ savedAt: Date.now() - JOBS_SCROLL_MAX_AGE - 1000 }, { savedAt: Date.now() + 100_000 }, { y: -1 }, { y: 9_000_000 }, { width: 1 }])("rejects stale, malformed, unreachable or resized coordinates %j", changes => {
  seed(changes); renderHook(() => useJobsScrollRestoration(props)); flush(); expect(scroll).not.toHaveBeenCalled();
});
it("does not jump after interaction while loading", () => {
  seed(); const view = renderHook(value => useJobsScrollRestoration(value), { initialProps: { ...props, ready: false } });
  act(() => window.dispatchEvent(new Event("wheel")));
  view.rerender(props); flush(); expect(scroll).not.toHaveBeenCalled();
});
it("captures scroll under the previous filter before changing context", () => {
  const view = renderHook(value => useJobsScrollRestoration(value), { initialProps: props }); flush();
  Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
  act(() => window.dispatchEvent(new Event("scroll")));
  view.rerender({ ...props, viewKey: "new-filter", ready: false });
  const saved = readJobsScrollPositions(window.sessionStorage.getItem(JOBS_SCROLL_STORAGE_KEY));
  expect(saved).toHaveLength(1); expect(saved[0].y).toBe(640); expect(saved[0].scope).toContain(props.viewKey);
});
it("works when session storage is blocked and leaves browser restoration unchanged", () => {
  const previous = window.history.scrollRestoration;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const view = renderHook(() => useJobsScrollRestoration(props)); flush(); view.unmount();
  expect(window.history.scrollRestoration).toBe(previous);
});
it("does not store or restore without an authenticated context", () => {
  seed(); const original = window.sessionStorage.getItem(JOBS_SCROLL_STORAGE_KEY);
  renderHook(() => useJobsScrollRestoration({ ...props, context: undefined })); flush();
  expect(scroll).not.toHaveBeenCalled(); expect(window.sessionStorage.getItem(JOBS_SCROLL_STORAGE_KEY)).toBe(original);
});

it("keeps the intended offset through late layout changes but stops after user interaction", () => {
  let resized!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe() {} disconnect = disconnect;
  });
  try {
    seed(); renderHook(() => useJobsScrollRestoration(props)); flush();
    expect(scroll).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 702 });
    act(() => { window.dispatchEvent(new Event("scroll")); resized([], {} as ResizeObserver); });
    expect(scroll).toHaveBeenLastCalledWith({ left: 0, top: 750, behavior: "instant" });
    expect(readJobsScrollPositions(window.sessionStorage.getItem(JOBS_SCROLL_STORAGE_KEY))[0].y).toBe(750);
    act(() => { window.dispatchEvent(new Event("wheel")); resized([], {} as ResizeObserver); });
    expect(scroll).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); }
});
