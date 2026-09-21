// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const m = vi.hoisted(() => ({ head: vi.fn(), get: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/s3", () => ({ resolveS3: m.resolve }));
import { loadVisionImage } from "@/lib/ai/images";
beforeEach(() => { vi.resetAllMocks(); m.resolve.mockResolvedValue({ bucket: "owned-bucket", client: { headObject: m.head, getObject: m.get } }); });
it("loads only owned storage, verifies version/bytes and creates a resized image for vision", async () => {
  const bytes = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer();
  m.head.mockReturnValue({ promise: async () => ({ ContentLength: bytes.length, ContentType: "image/png", ETag: "version" }) }); m.get.mockReturnValue({ promise: async () => ({ Body: bytes }) });
  const result = await loadVisionImage("forms/job/capture/actor/photo.png", "capture");
  const metadata = await sharp(Buffer.from(result.data, "base64")).metadata(); expect(metadata).toMatchObject({ format: "jpeg", width: 1280, height: 640 });
  expect(m.get).toHaveBeenCalledWith({ Bucket: "owned-bucket", Key: "forms/job/capture/actor/photo.png", Range: `bytes=0-${bytes.length - 1}`, IfMatch: "version" });
});
it("loads an authorized legacy cleaner job image from the same configured storage", async () => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  m.head.mockReturnValue({ promise: async () => ({ ContentLength: bytes.length, ContentType: "image/png", ETag: "legacy" }) });
  m.get.mockReturnValue({ promise: async () => ({ Body: bytes }) });
  expect(await loadVisionImage("jobs/old-job/cleaner/photo.png", "old-photo")).toMatchObject({ id: "old-photo", mediaType: "image/jpeg" });
  expect(m.head).toHaveBeenCalledWith({ Bucket: "owned-bucket", Key: "jobs/old-job/cleaner/photo.png" });
});
it.each(["https://external.test/image", "form-references/../secret", "forms//photo", "forms/job\\photo"])("never retrieves unsafe storage paths %s", async key => {
  await expect(loadVisionImage(key, "id")).rejects.toThrow(); expect(m.resolve).not.toHaveBeenCalled();
});
it.each([{ ContentLength: 6 * 1024 * 1024, ContentType: "image/png" }, { ContentLength: 5, ContentType: "text/html" }, { ContentLength: 0, ContentType: "image/jpeg" }])("rejects large/unsupported/empty objects %#", async head => {
  m.head.mockReturnValue({ promise: async () => head }); await expect(loadVisionImage("forms/job/photo", "id")).rejects.toThrow(); expect(m.get).not.toHaveBeenCalled();
});
it("rejects truncated and disguised nonimage bytes before provider use", async () => {
  m.head.mockReturnValue({ promise: async () => ({ ContentLength: 3, ContentType: "image/jpeg" }) });
  m.get.mockReturnValueOnce({ promise: async () => ({ Body: Buffer.from("x") }) }).mockReturnValueOnce({ promise: async () => ({ Body: Buffer.from("abc") }) });
  await expect(loadVisionImage("forms/job/photo", "id")).rejects.toThrow("changed"); await expect(loadVisionImage("forms/job/photo", "id")).rejects.toThrow();
});
