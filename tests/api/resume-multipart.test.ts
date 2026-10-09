// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), head: vi.fn(), list: vi.fn(), create: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://cdn.test/${key}`, resolveS3: async () => ({ bucket: "bucket", client: {
 headObject: (args: unknown) => ({ promise: () => mocks.head(args) }), listParts: (args: unknown) => ({ promise: () => mocks.list(args) }),
 createMultipartUpload: (args: unknown) => ({ promise: () => mocks.create(args) }), getSignedUrlPromise: mocks.sign,
} }) }));
import { POST } from "@/app/api/uploads/resume-multipart/route";
const partSize = 5 * 1024 * 1024;
const input = { key: "forms/job/capture/cleaner/video.mp4", uploadId: "upload", size: partSize + 3, partSize, contentType: "video/mp4" };
const send = (patch = {}) => POST(new NextRequest("http://localhost/api/uploads/resume-multipart", { method: "POST", body: JSON.stringify({ ...input, ...patch }) }));
beforeEach(() => {
 vi.resetAllMocks();
 mocks.session.mockResolvedValue({ user: { id: "cleaner" } });
 mocks.head.mockRejectedValue({ code: "NotFound", statusCode: 404 });
 mocks.list.mockResolvedValue({ Parts: [{ PartNumber: 1, ETag: '"first"', Size: partSize }] });
 mocks.create.mockResolvedValue({ UploadId: "replacement" });
 mocks.sign.mockResolvedValue("https://storage.test/part");
});
it("returns confirmed parts and fresh signed URLs for the same allocation", async () => {
 const response = await send();
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ key: input.key, uploadId: "upload", uploadedParts: [{ PartNumber: 1, ETag: '"first"', Size: partSize }] });
 expect(mocks.create).not.toHaveBeenCalled();
 expect(mocks.sign).toHaveBeenCalledTimes(2);
});
it("recovers a lost completion response without another upload", async () => {
 mocks.head.mockResolvedValue({ ContentLength: input.size });
 expect(await (await send()).json()).toMatchObject({ completed: true, key: input.key });
 expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it("restarts an old aborted upload only at its existing key", async () => {
 mocks.list.mockRejectedValue({ code: "NoSuchUpload" });
 expect(await (await send()).json()).toMatchObject({ key: input.key, uploadId: "replacement", uploadedParts: [] });
 expect(mocks.head).toHaveBeenCalledTimes(2);
 expect(mocks.create).toHaveBeenCalledWith({ Bucket: "bucket", Key: input.key, ContentType: "video/mp4" });
});
it("handles completion racing with the parts lookup", async () => {
 mocks.list.mockRejectedValue({ code: "NoSuchUpload" });
 mocks.head.mockRejectedValueOnce({ code: "NotFound" }).mockResolvedValueOnce({ ContentLength: input.size });
 expect(await (await send()).json()).toMatchObject({ completed: true });
 expect(mocks.create).not.toHaveBeenCalled();
});
it("does not recreate an upload on storage outages or denied access", async () => {
 mocks.list.mockRejectedValue({ code: "AccessDenied", message: "Storage unavailable" });
 expect((await send()).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
});
it("does not trust an object with different bytes or part lengths", async () => {
 mocks.head.mockResolvedValueOnce({ ContentLength: 1 });
 expect((await send()).status).toBe(400);
 mocks.list.mockResolvedValueOnce({ Parts: [{ PartNumber: 1, ETag: "receipt", Size: 1 }] });
 expect((await send()).status).toBe(400); expect(mocks.create).not.toHaveBeenCalled();
});
it.each(["forms/job/capture/other/video.mp4", "../cleaner/video.mp4"])("denies unsafe ownership %s", async key => {
 expect((await send({ key })).status).toBe(403); expect(mocks.head).not.toHaveBeenCalled();
});
it("requires a live session", async () => {
 mocks.session.mockRejectedValue(new Error("UNAUTHORIZED"));
 expect((await send()).status).toBe(401); expect(mocks.head).not.toHaveBeenCalled();
});
it("reads all pages of parts", async () => {
 mocks.list.mockResolvedValueOnce({ Parts: [{ PartNumber: 1, ETag: "a", Size: partSize }], IsTruncated: true, NextPartNumberMarker: 1 })
 .mockResolvedValueOnce({ Parts: [{ PartNumber: 2, ETag: "b", Size: 3 }] });
 expect((await (await send()).json()).uploadedParts).toHaveLength(2);
 expect(mocks.list.mock.calls[1][0].PartNumberMarker).toBe(1);
});
