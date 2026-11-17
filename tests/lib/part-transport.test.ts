import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PartTransferError, sendPart } from "@/lib/uploads/part-transport";
import { FakeXhr } from "../helpers/fake-xhr";

const STALL = 60_000;
const CEILING = 15 * 60_000;

beforeEach(() => {
  FakeXhr.reset();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function body(size = 1_000) {
  return new Blob([new Uint8Array(size)]);
}

it("completes a slow part that keeps moving well past two minutes", async () => {
  const onBytes = vi.fn();
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING, onBytes });
  const xhr = FakeXhr.instances[0];
  for (let step = 1; step <= 10; step++) {
    await vi.advanceTimersByTimeAsync(50_000);
    xhr.progress(step * 100);
  }
  xhr.respond(200, { ETag: '"receipt"' });
  await expect(result).resolves.toMatchObject({ status: 200, etag: '"receipt"', observedProgress: true });
  expect(onBytes).toHaveBeenLastCalledWith(1_000);
  expect(xhr.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("fails with a stall after the window passes with no bytes moving", async () => {
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING });
  const assertion = expect(result).rejects.toMatchObject({ kind: "stall", bytesSent: 300 });
  const xhr = FakeXhr.instances[0];
  xhr.progress(300);
  await vi.advanceTimersByTimeAsync(STALL - 1);
  expect(xhr.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  await assertion;
  expect(xhr.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not treat a frozen hidden tab as a stall, but the ceiling still releases it", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING });
  const assertion = expect(result).rejects.toMatchObject({ kind: "ceiling" });
  await vi.advanceTimersByTimeAsync(STALL * 3);
  expect(FakeXhr.instances[0].aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(CEILING);
  await assertion;
  expect(FakeXhr.instances[0].aborted).toBe(true);
});

it("allows a longer wait for the answer once every byte has been sent", async () => {
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING });
  const xhr = FakeXhr.instances[0];
  xhr.progress(1_000);
  await vi.advanceTimersByTimeAsync(STALL + 30_000);
  expect(xhr.aborted).toBe(false);
  xhr.respond(200, { etag: "receipt" });
  await expect(result).resolves.toMatchObject({ status: 200 });
});

it("bounds a part that trickles forever with the absolute ceiling", async () => {
  const result = sendPart({ url: "https://storage.test/part", body: body(CEILING), stallMs: STALL, ceilingMs: CEILING });
  const assertion = expect(result).rejects.toBeInstanceOf(PartTransferError);
  const xhr = FakeXhr.instances[0];
  for (let second = 1; second <= CEILING / 30_000 + 1; second++) {
    await vi.advanceTimersByTimeAsync(30_000);
    xhr.progress(second);
  }
  await assertion;
  await expect(result).rejects.toMatchObject({ kind: "ceiling" });
});

it("reports an immediate network refusal with zero bytes sent", async () => {
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING });
  FakeXhr.instances[0].fail();
  await expect(result).rejects.toMatchObject({ kind: "network", bytesSent: 0 });
});

it("aborts the request with the caller's reason and never reports a transfer error", async () => {
  const controller = new AbortController();
  const reason = new Error("left the job");
  const result = sendPart({ url: "https://storage.test/part", body: body(), signal: controller.signal, stallMs: STALL, ceilingMs: CEILING });
  FakeXhr.instances[0].progress(500);
  controller.abort(reason);
  await expect(result).rejects.toBe(reason);
  expect(FakeXhr.instances[0].aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not open a request after cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(sendPart({ url: "https://storage.test/part", body: body(), signal: controller.signal, stallMs: STALL, ceilingMs: CEILING })).rejects.toThrow("cancelled");
  expect(FakeXhr.instances).toHaveLength(0);
});

it("parses the application's proxy receipt and sends its declared size header", async () => {
  const result = sendPart({ url: "/api/uploads/part?partNumber=1", body: body(), headers: { "x-upload-size": "1000" }, parseJson: true, stallMs: STALL, ceilingMs: CEILING });
  const xhr = FakeXhr.instances[0];
  expect(xhr.requestHeaders["x-upload-size"]).toBe("1000");
  xhr.respond(200, {}, JSON.stringify({ etag: "receipt" }));
  await expect(result).resolves.toMatchObject({ status: 200, json: { etag: "receipt" } });
});

it("keeps a storage error body for classification", async () => {
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING });
  FakeXhr.instances[0].respond(400, {}, "<Error><Code>RequestTimeout</Code></Error>");
  await expect(result).resolves.toMatchObject({ status: 400, body: expect.stringContaining("RequestTimeout") });
});

it("falls back to fetch bounded by the ceiling when XHR is unavailable", async () => {
  vi.stubGlobal("XMLHttpRequest", undefined);
  const fetcher = vi.fn(async (_url: string, options?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })));
  vi.stubGlobal("fetch", fetcher);
  const result = sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING });
  const assertion = expect(result).rejects.toMatchObject({ kind: "ceiling", bytesSent: 0 });
  // No progress is observable through fetch, so the stall window cannot apply.
  await vi.advanceTimersByTimeAsync(STALL * 2);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(CEILING);
  await assertion;
});

it("reports the whole body once a fetch fallback succeeds", async () => {
  vi.stubGlobal("XMLHttpRequest", undefined);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { headers: { etag: "receipt" } })));
  const onBytes = vi.fn();
  await expect(sendPart({ url: "https://storage.test/part", body: body(), stallMs: STALL, ceilingMs: CEILING, onBytes }))
    .resolves.toMatchObject({ status: 200, etag: "receipt", observedProgress: false });
  expect(onBytes).toHaveBeenCalledWith(1_000);
});
