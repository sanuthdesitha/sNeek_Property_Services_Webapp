import { afterEach, expect, it, vi } from "vitest";
import { deviceStorageAdvice, imageCaptureAdvice, inspectImageCapture } from "@/lib/uploads/capture-advice";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("warns about observable darkness and low resolution without certifying readable images", () => {
  expect(imageCaptureAdvice(1200, 800, [0, 0, 0, 255])).toEqual([expect.stringContaining("appears dark")]);
  expect(imageCaptureAdvice(1200, 240, [200, 200, 200, 255])).toEqual([expect.stringContaining("low resolution")]);
  expect(imageCaptureAdvice(800, 1200, [180, 180, 180, 255])).toEqual([]);
  expect(imageCaptureAdvice(0, 0, [])).toEqual([expect.stringContaining("could not be previewed")]);
  expect(imageCaptureAdvice(800, 800, [0, 0, 0, 0])).toEqual([]);
});
it("labels only valid low storage estimates and bounds a stalled browser estimate", async () => {
  const estimate = vi.fn().mockResolvedValue({ quota: 100_000_000, usage: 99_000_000 });
  vi.stubGlobal("navigator", { storage: { estimate } });
  expect(await deviceStorageAdvice(1000)).toEqual([expect.stringContaining("Estimated browser storage is low")]);
  estimate.mockResolvedValue({ quota: 1_000_000_000, usage: 1 }); expect(await deviceStorageAdvice(1000)).toEqual([]);
  estimate.mockRejectedValue(new Error("unsupported")); expect(await deviceStorageAdvice(1000)).toEqual([]);
  estimate.mockResolvedValue({ quota: NaN, usage: 1 }); expect(await deviceStorageAdvice(1000)).toEqual([]);
  vi.useFakeTimers(); estimate.mockReturnValue(new Promise(() => {}));
  const pending = deviceStorageAdvice(1000); await vi.advanceTimersByTimeAsync(1000); expect(await pending).toEqual([]);
});
it("preserves source orientation for analysis, closes decoded pixels and leaves original bytes untouched", async () => {
  const file = new File(["original"], "photo.jpg", { type: "image/jpeg" });
  const close = vi.fn(); const decode = vi.fn().mockResolvedValue({ width: 1200, height: 800, close });
  vi.stubGlobal("createImageBitmap", decode);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([10, 10, 10, 255]) }) } as any);
  expect(await inspectImageCapture(file)).toEqual([expect.stringContaining("appears dark")]);
  expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
  expect(close).toHaveBeenCalledOnce(); expect(file.size).toBe(8);
});
it("reports unsupported or unreadable preview without throwing away the file", async () => {
  const file = new File(["bad"], "photo.heic", { type: "image/heic" });
  vi.stubGlobal("createImageBitmap", undefined); expect(await inspectImageCapture(file)).toEqual([expect.stringContaining("unavailable")]);
  vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("codec"))); expect(await inspectImageCapture(file)).toEqual([expect.stringContaining("Keep the original")]);
  expect(await inspectImageCapture(new File(["pdf"], "file.pdf"))).toEqual([]);
});
it("releases a late decode after a bounded preview timeout", async () => {
  vi.useFakeTimers(); let resolve!: (value: any) => void; const close = vi.fn();
  vi.stubGlobal("createImageBitmap", () => new Promise(value => { resolve = value; }));
  const pending = inspectImageCapture(new File(["original"], "photo.jpg", { type: "image/jpeg" }));
  await vi.advanceTimersByTimeAsync(5000); expect(await pending).toEqual([expect.stringContaining("could not preview")]);
  resolve({ width: 800, height: 800, close }); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
});
