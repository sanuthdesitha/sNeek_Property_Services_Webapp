import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compressVideo } from "@/lib/uploads/compress-video";
const mocks = vi.hoisted(() => ({ init: vi.fn(), inputDispose: vi.fn(), cancel: vi.fn(), execute: vi.fn() }));
vi.mock("mediabunny", () => ({
  Input: class { getPrimaryVideoTrack = async () => ({ displayWidth: 1920, displayHeight: 1080 }); dispose = mocks.inputDispose; },
  BlobSource: class {}, BufferTarget: class { buffer = new Uint8Array([1, 2, 3]).buffer; },
  Output: class {}, Mp4OutputFormat: class {}, Quality: class {}, ALL_FORMATS: [], Conversion: { init: mocks.init },
}));
beforeEach(() => {
  vi.resetAllMocks(); mocks.cancel.mockResolvedValue(undefined); mocks.execute.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { storage: { getDirectory: vi.fn().mockRejectedValue(new Error("unsupported storage")) } });
});
afterEach(() => vi.unstubAllGlobals());
it("refuses a conversion that would discard audio and keeps the original intact", async () => {
  mocks.init.mockResolvedValue({ isValid: true, discardedTracks: [{ type: "audio" }], cancel: mocks.cancel, execute: mocks.execute });
  const original = new File([new Uint8Array(100)], "walkthrough.mov", { type: "video/quicktime" });
  await expect(compressVideo(original)).rejects.toThrow("with all its tracks");
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.cancel).toHaveBeenCalledOnce(); expect(mocks.inputDispose).toHaveBeenCalledOnce(); expect(original.size).toBe(100);
});
it("rejects unsupported video before conversion starts", async () => {
  mocks.init.mockResolvedValue({ isValid: false, discardedTracks: [], cancel: mocks.cancel, execute: mocks.execute });
  await expect(compressVideo(new File(["source"], "video.mov", { type: "video/quicktime" }))).rejects.toThrow("Try an MP4 video");
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.inputDispose).toHaveBeenCalledOnce();
});
