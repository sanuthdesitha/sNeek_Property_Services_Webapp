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
  it("commits the allocated key and upload id before dispatching any part", async () => {
    let persisted = false;
    const part = vi.fn(async () => { expect(persisted).toBe(true); return new Response(null, { headers: { etag: "receipt" } }); });
    transport(part);
    await uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async allocation => {
      expect(allocation).toEqual({ key: "jobs/user/clip.mp4", uploadId: "upload" });
      expect(part).not.toHaveBeenCalled(); persisted = true;
    });
    expect(part).toHaveBeenCalledOnce();
  });
  it("sends no bytes and aborts the empty allocation when durable identity persistence fails", async () => {
    const part = vi.fn(async () => new Response(null, { headers: { etag: "receipt" } }));
    const fetcher = transport(part);
    await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {
      throw new Error("device quota");
    })).rejects.toThrow("device quota");
    expect(part).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
    expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/complete-multipart", expect.anything());
  });
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

it("retains successful parts after a failed durable upload and resumes only missing bytes", async () => {
  const size = 5 * 1024 * 1024;
  const blob = new Blob([new Uint8Array(size + 3)]);
  let retry = false;
  const saved = vi.fn(async () => {});
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/1", "https://storage.test/2"] });
    if (url.endsWith("resume-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/1", "https://storage.test/2"], uploadedParts: [{ PartNumber: 1, ETag: "first", Size: size }] });
    if (url === "https://storage.test/1") return new Response(null, { headers: { etag: "first" } });
    if (url === "https://storage.test/2") return retry ? new Response(null, { headers: { etag: "second" } }) : new Response(null, { status: 503 });
    if (url.endsWith("complete-multipart")) {
      expect(JSON.parse(options!.body as string).parts).toEqual([{ PartNumber: 1, ETag: "first" }, { PartNumber: 2, ETag: "second" }]);
      return Response.json({ key: "jobs/user/clip.mp4", url: "https://cdn.test/clip.mp4" });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(blob, "clip.mp4", "video/mp4", undefined, undefined, "jobs", saved)).rejects.toThrow("Part 2");
  expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
  retry = true;
  await uploadMultipart(blob, "clip.mp4", "video/mp4", undefined, undefined, "jobs", saved, { key: "jobs/user/clip.mp4", uploadId: "upload" });
  expect(fetcher.mock.calls.filter(([url]) => url === "https://storage.test/1")).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("presign-multipart"))).toHaveLength(1);
});
it("accepts verified completion after the response was lost without sending more parts", async () => {
  const fetcher = vi.fn(async () => Response.json({ completed: true, key: "owned/key", url: "https://cdn.test/key" }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, undefined, async () => {}, { key: "owned/key", uploadId: "upload" })).resolves.toEqual({ key: "owned/key", url: "https://cdn.test/key" });
  expect(fetcher).toHaveBeenCalledOnce();
});
it("refuses recovery into a different key", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ completed: true, key: "wrong/key", url: "https://cdn.test/key" })));
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, undefined, async () => {}, { key: "owned/key", uploadId: "upload" })).rejects.toThrow("different file");
});

it("uses the authenticated fallback when a signed URL expires", async () => {
  const fetcher = transport(async () => new Response(null, { status: 403 }));
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
    if (url === "https://storage.test/part") return new Response(null, { status: 403 });
    if (url.startsWith("/api/uploads/part?")) return Response.json({ etag: "receipt" });
    return Response.json({ key: "jobs/user/clip.mp4", url: "https://cdn.test/clip.mp4" });
  });
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4")).resolves.toHaveProperty("key");
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/uploads/part?"), expect.anything());
});
it("bounds a stalled transfer and falls back without losing the capture", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
      if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
      if (url === "https://storage.test/part") return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
      if (url.startsWith("/api/uploads/part?")) return Response.json({ etag: "receipt" });
      return Response.json({ key: "jobs/user/clip.mp4", url: "https://cdn.test/clip.mp4" });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, undefined, async () => {});
    await vi.advanceTimersByTimeAsync(120_001);
    await expect(result).resolves.toHaveProperty("key");
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/uploads/part?"), expect.anything());
  } finally { vi.useRealTimers(); }
});
it("keeps the durable allocation when a transfer is cancelled mid-request", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
    if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
      controller.abort();
    });
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, controller.signal, undefined, async () => {})).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("retains a durable upload when completion fails instead of deleting its parts", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
    if (url === "https://storage.test/part") return new Response(null, { headers: { etag: "receipt" } });
    return Response.json({ error: "Temporary completion failure" }, { status: 503 });
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, undefined, async () => {})).rejects.toThrow("Temporary completion failure");
  expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
});


it("preserves saved parts when persisting a resumed allocation fails", async () => {
  const fetcher = vi.fn(async () => Response.json({
    key: "jobs/user/clip.mp4", uploadId: "upload",
    partUrls: ["https://storage.test/part"],
    uploadedParts: [{ PartNumber: 1, ETag: "saved", Size: 5 }],
  }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {
    throw new Error("device storage unavailable");
  }, { key: "jobs/user/clip.mp4", uploadId: "upload" })).rejects.toThrow("device storage unavailable");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
});

it.each(["presign-multipart", "resume-multipart", "complete-multipart"])("bounds a stalled %s request and preserves durable recovery", async endpoint => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
      if (url.endsWith(endpoint)) return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options!.signal!.reason), { once: true }));
      if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
      if (url === "https://storage.test/part") return new Response(null, { headers: { etag: "receipt" } });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {},
      endpoint === "resume-multipart" ? { key: "jobs/user/clip.mp4", uploadId: "upload" } : undefined);
    const assertion = expect(result).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
    expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith(endpoint))).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it("keeps the timeout active while reading a part proxy receipt", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async (url: string, options?: RequestInit): Promise<Response> => {
      if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
      if (url === "https://storage.test/part") throw new TypeError("CORS blocked");
      if (url.startsWith("/api/uploads/part?")) return {
        ok: true,
        json: () => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options!.signal!.reason), { once: true })),
      } as Response;
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {});
    const assertion = expect(result).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(362_000);
    await assertion;
    expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/complete-multipart", expect.anything());
    expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
  } finally { vi.useRealTimers(); }
});


it("retries request timeouts for a part without allocating another upload", async () => {
  const part = vi.fn().mockResolvedValueOnce(new Response(null, { status: 408 }))
    .mockResolvedValueOnce(new Response(null, { headers: { etag: "receipt" } }));
  const fetcher = transport(part);
  await uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4");
  expect(part).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("presign-multipart"))).toHaveLength(1);
});

it.each([{ key: "wrong/key", url: "https://cdn.test/video" }, { key: "jobs/user/clip.mp4" }])("rejects an invalid completion receipt and retains recovery", async invalid => {
  const fetcher = transport(async () => new Response(null, { headers: { etag: "receipt" } }));
  fetcher.mockImplementation(async (url: string) => {
    if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
    if (url === "https://storage.test/part") return new Response(null, { headers: { etag: "receipt" } });
    return Response.json(invalid);
  });
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {})).rejects.toThrow("invalid completion receipt");
  expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
});

it("rejects an empty file before allocating storage", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob([]), "empty.mp4", "video/mp4")).rejects.toThrow("empty file");
  expect(fetcher).not.toHaveBeenCalled();
});

it("reports a non-JSON allocation rejection without sending file bytes", async () => {
  const fetcher = vi.fn(async () => new Response("gateway rejected", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4")).rejects.toThrow("Upload request failed (503)");
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  { key: "" }, { uploadId: "" }, { partUrls: null }, { partUrls: [] }, { partUrls: [""] }, { partUrls: [42] },
])("rejects an invalid allocation before transferring any bytes", async invalid => {
  const fetcher = vi.fn(async () => Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"], ...invalid }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4")).rejects.toThrow("invalid upload allocation");
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([
  { PartNumber: 0.5, ETag: "saved", Size: 5 }, { PartNumber: 0, ETag: "saved", Size: 5 },
  { PartNumber: 2, ETag: "saved", Size: 5 }, { PartNumber: 1, ETag: "", Size: 5 },
  { PartNumber: 1, ETag: "saved", Size: 4 },
])("rejects invalid retained part metadata without resending the original", async part => {
  const fetcher = vi.fn(async () => Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"], uploadedParts: [part] }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {}, { key: "jobs/user/clip.mp4", uploadId: "upload" })).rejects.toThrow("invalid saved video parts");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("rejects duplicate retained parts rather than double-counting upload progress", async () => {
  const part = { PartNumber: 1, ETag: "saved", Size: 5 };
  const fetcher = vi.fn(async () => Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"], uploadedParts: [part, part] }));
  vi.stubGlobal("fetch", fetcher);
  const progress = vi.fn();
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", progress, undefined, "jobs", async () => {}, { key: "jobs/user/clip.mp4", uploadId: "upload" })).rejects.toThrow("invalid saved video parts");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(progress).not.toHaveBeenCalled();
});

it.each([undefined, ""])("rejects a recovered completion without a usable URL", async url => {
  const fetcher = vi.fn(async () => Response.json({ completed: true, key: "jobs/user/clip.mp4", url }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {}, { key: "jobs/user/clip.mp4", uploadId: "upload" })).rejects.toThrow("receipt is missing");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("reports full progress after exact-key completion recovery without sending parts", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ completed: true, key: "jobs/user/clip.mp4", url: "/video" })));
  const progress = vi.fn();
  await uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", progress, undefined, "jobs", async () => {}, { key: "jobs/user/clip.mp4", uploadId: "upload" });
  expect(progress).toHaveBeenCalledOnce();
  expect(progress).toHaveBeenCalledWith({ bytesUploaded: 5, totalBytes: 5, partsCompleted: 1, partsTotal: 1 });
});

it("reports confirmed progress and completes after a transient proxy rejection", async () => {
  vi.useFakeTimers();
  try {
    let proxies = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
      if (url === "https://storage.test/part") throw new TypeError("CORS blocked");
      if (url.startsWith("/api/uploads/part?")) return ++proxies === 1 ? new Response(null, { status: 429 }) : Response.json({ etag: "receipt" });
      if (url.endsWith("complete-multipart")) return Response.json({ key: "jobs/user/clip.mp4", url: "/video" });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const progress = vi.fn();
    const result = uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", progress, undefined, "jobs", async () => {});
    await vi.runAllTimersAsync();
    await expect(result).resolves.toHaveProperty("key", "jobs/user/clip.mp4");
    expect(proxies).toBe(2);
    expect(progress).toHaveBeenNthCalledWith(1, { bytesUploaded: 0, totalBytes: 5, partsCompleted: 0, partsTotal: 1 });
    expect(progress).toHaveBeenLastCalledWith({ bytesUploaded: 5, totalBytes: 5, partsCompleted: 1, partsTotal: 1 });
    expect(fetcher.mock.calls.filter(([url]) => url === "https://storage.test/part")).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it("stops immediately on a permanent proxy denial and keeps durable recovery metadata", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("presign-multipart")) return Response.json({ key: "jobs/user/clip.mp4", uploadId: "upload", partUrls: ["https://storage.test/part"] });
    if (url === "https://storage.test/part") throw new TypeError("CORS blocked");
    return new Response(null, { status: 401 });
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadMultipart(new Blob(["video"]), "clip.mp4", "video/mp4", undefined, undefined, "jobs", async () => {})).rejects.toThrow("Part 1 upload failed (401)");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher).not.toHaveBeenCalledWith("/api/uploads/abort-multipart", expect.anything());
});
