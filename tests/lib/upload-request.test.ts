import { afterEach, expect, it, vi } from "vitest";
import { uploadRequest } from "@/lib/uploads/request";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("reads a complete response and cleans up its timer and parent listener", async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const remove = vi.spyOn(parent.signal, "removeEventListener");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  expect(await uploadRequest("/upload", {}, response => response.json(), parent.signal)).toEqual({ ok: true });
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a network error and cleans up after rejection", async () => {
  vi.useFakeTimers();
  const error = new TypeError("connection lost");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
  await expect(uploadRequest("/upload", {}, response => response.json())).rejects.toBe(error);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not start an already cancelled request", async () => {
  const parent = new AbortController();
  parent.abort(new Error("cancelled"));
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadRequest("/upload", {}, response => response.json(), parent.signal)).rejects.toThrow("cancelled");
  expect(fetcher).not.toHaveBeenCalled();
});

it("cancels a pending response body with the parent request", async () => {
  const parent = new AbortController();
  const error = new Error("user cancelled");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => ({
    json: async () => {
      parent.abort(error);
      expect(options.signal.aborted).toBe(true);
      return { ok: true };
    },
  })));
  await expect(uploadRequest("/upload", {}, response => response.json(), parent.signal)).rejects.toBe(error);
});

it("keeps a deadline through body parsing, even when the reader catches an abort", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
  const result = uploadRequest("/upload", {}, async () => {
    await vi.advanceTimersByTimeAsync(30_001);
    return { ok: true };
  });
  await expect(result).rejects.toThrow("timed out");
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves a malformed response error and removes the parent listener", async () => {
  const parent = new AbortController();
  const remove = vi.spyOn(parent.signal, "removeEventListener");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON")));
  await expect(uploadRequest("/upload", {}, response => response.json(), parent.signal)).rejects.toBeInstanceOf(SyntaxError);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

it("aborts a pending fetch with the caller's reason instead of treating cancellation as success", async () => {
  const parent = new AbortController();
  const reason = new Error("left this job");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    parent.abort(reason);
  })));
  await expect(uploadRequest("/upload", {}, response => response.json(), parent.signal)).rejects.toBe(reason);
});
