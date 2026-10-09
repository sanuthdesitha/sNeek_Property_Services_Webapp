// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ session: vi.fn(), upload: vi.fn(), abort: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/s3", () => ({ resolveS3: async () => ({ bucket: "bucket", client: { uploadPart: (args: any) => ({ promise: () => mocks.upload(args), abort: mocks.abort }) } }) }));
import { PUT } from "@/app/api/uploads/part/route";
function send(size = "3", key = "forms/job/capture/cleaner/video.mp4") {
 const params = new URLSearchParams({ key, uploadId: "upload", partNumber: "1" });
 return PUT(new NextRequest(`http://localhost/api/uploads/part?${params}`, { method: "PUT", body: "abc", headers: { "x-upload-size": size } }));
}
beforeEach(() => {
 vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "cleaner" } });
 mocks.upload.mockImplementation(async (args: any) => { let bytes = ""; for await (const chunk of args.Body) bytes += chunk.toString(); expect(bytes).toBe("abc"); return { ETag: "receipt" }; });
});
it("streams exactly the declared part and returns its receipt", async () => { expect(await (await send()).json()).toEqual({ etag: "receipt" }); });
it("reports transient storage errors as retryable", async () => {
 mocks.upload.mockRejectedValue(new Error("Storage connection timed out"));
 expect((await send()).status).toBe(503);
});
it.each(["2", "4"])("rejects inaccurate declared size %s", async size => { expect((await send(size)).status).toBe(400); });
it("does not proxy another user's parts", async () => {
 expect((await send("3", "forms/job/capture/other/video.mp4")).status).toBe(403); expect(mocks.upload).not.toHaveBeenCalled();
});
it("requires authentication", async () => {
 mocks.session.mockRejectedValue(new Error("UNAUTHORIZED")); expect((await send()).status).toBe(401);
});
