import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadMultipart } from "@/lib/uploads/multipart-client";

afterEach(() => vi.unstubAllGlobals());

function transport(part: () => Promise<Response>) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("presign-multipart")) return Response.json({ uploadId: "upload", key: "jobs/user/clip.mp4", partUrls: ["https://storage.test/part"] });
    if (url === "https://storage.test/part") return part();
    return Response.json({ key: "jobs/user/clip.mp4", url: "https://storage.test/clip.mp4" });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("multipart upload recovery", () => {
  it("streams via the application when browser-to-bucket requests are blocked", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("presign-multipart")) return Response.json({ uploadId: "upload", key: "jobs/user/clip.mp4", partUrls: ["https://storage.test/part"] });
      if (url === "https://storage.test/part") throw new TypeError("Failed to fetch");
      if (url.startsWith("/api/uploads/part?")) return Response.json({ etag: "receipt" });
      return Response.json({ key: "jobs/user/clip.mp4", url: "https://storage.test/clip.mp4" });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4")).resolves.toHaveProperty("key");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/uploads/part?"), expect.objectContaining({ method: "PUT" }));
    expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
  });

  it("retries a transient part failure and completes only with its receipt", async () => {
    const part = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { headers: { etag: '"receipt"' } }));
    const fetcher = transport(part);
    await uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4");
    expect(part).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledWith("/api/uploads/complete-multipart", expect.objectContaining({
      body: JSON.stringify({ uploadId: "upload", key: "jobs/user/clip.mp4", parts: [{ PartNumber: 1, ETag: "receipt" }] }),
    }));
  });

  it("aborts incomplete storage uploads when CORS hides the receipt", async () => {
    const fetcher = transport(async () => new Response(null));
    await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4")).rejects.toThrow("ETag");
    expect(fetcher).toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
    expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/complete-multipart", expect.anything());
  });

  it("does not initiate storage work after cancellation", async () => {
    const fetcher = transport(async () => new Response(null));
    const controller = new AbortController();
    controller.abort();
    await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, controller.signal)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
