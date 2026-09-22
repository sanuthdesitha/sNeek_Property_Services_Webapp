import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const evidenceStore = vi.hoisted(() => ({ rows: new Map<string, any>(), writes: 0, failAt: 0 }));
vi.mock("@/lib/cleaner/evidence-store", async original => ({
  ...await original<typeof import("@/lib/cleaner/evidence-store")>(),
  getEvidence: async (id: string) => evidenceStore.rows.get(id),
  putEvidence: async (record: any) => { if (++evidenceStore.writes === evidenceStore.failAt) throw new Error("quota exceeded"); evidenceStore.rows.set(record.id, record); },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uploads/compress-video", () => ({
  isVideoFile: (file: File) => file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name),
  compressVideo: vi.fn(async (file: File) => ({ file, dispose: async () => {} })),
}));

// The canvas work is irrelevant to the pool; pass the file straight through.
vi.mock("@/lib/uploads/compress", () => ({
  prepareUploadFile: vi.fn(async (file: File) => file),
}));
vi.mock("@/lib/uploads/stamp", () => ({
  isStampableImage: () => false,
}));
vi.mock("@/lib/geo/get-position", () => ({
  getAccuratePosition: vi.fn(async () => null),
}));

/**
 * Anything over 10MB now bypasses our server entirely: presigned parts,
 * straight to S3. That is the whole point of the large-video fix, and it means
 * the XHR stand-in below never sees a big file. Without this mock the video
 * assertions would pass vacuously — zero uploads, zero failures, zero
 * concurrency — which is exactly how they failed when the path changed.
 *
 * `multipartHooks` is filled in by installFakeXhr so BOTH transports record
 * into the same concurrency counters.
 */
const multipartHooks: {
  run?: (file: { name: string; size: number }, onProgress?: (p: any) => void) => Promise<any>;
} = {};

vi.mock("@/lib/uploads/multipart-client", () => ({
  uploadMultipart: vi.fn(
    async (
      blob: Blob,
      filename: string,
      _contentType: string,
      onProgress?: (p: any) => void,
      _signal?: AbortSignal,
      folder?: string,
      onAllocated?: (allocation: { key: string; uploadId: string }) => Promise<void>
    ) => {
      if (!multipartHooks.run) throw new Error("multipart fake not installed");
      const allocation = { key: `${folder}/cleaner/${filename}`, uploadId: `upload-${filename}` };
      await onAllocated?.(allocation);
      const receipt = await multipartHooks.run({ name: filename, size: blob.size }, onProgress);
      return onAllocated ? { ...receipt, key: allocation.key } : receipt;
    }
  ),
}));

import { prepareAndUploadFiles } from "@/components/v2/cleaner/media-capture";
import { compressVideo } from "@/lib/uploads/compress-video";
import { uploadMultipart } from "@/lib/uploads/multipart-client";

/**
 * Two bugs live here.
 *
 * Unbounded concurrency: thirty photos opened thirty simultaneous POSTs on a
 * phone, and the ones that queued at the socket layer died quietly.
 *
 * And videos, which failed almost every time — ffmpeg ran INSIDE the request,
 * so the proxy timed the upload out mid-transcode and the client then retried,
 * re-sending the whole clip. Videos now get their own single-file lane and are
 * never auto-retried.
 */

type Verdict = "ok" | number | "network";

function fakeFile(name: string, sizeBytes = 1024, type = "image/jpeg"): File {
  const file = new File(["x"], name, { type });
  // File.size is read-only; the pipeline reads it to choose lane and retry.
  Object.defineProperty(file, "size", { value: sizeBytes });
  return file;
}

/**
 * Minimal XHR stand-in. Records concurrency so the pool can be asserted, and
 * lets each file be given its own verdict.
 */
function installFakeXhr(behaviour: (name: string) => Verdict, delayMs = 5) {
  const state = { inFlight: 0, peak: 0, heavyPeak: 0, calls: [] as string[], folders: [] as string[] };

  class FakeXhr {
    upload = { onprogress: null as null | ((e: any) => void) };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    onabort: null | (() => void) = null;
    status = 0;
    responseText = "";

    open() {}

    send(fd: FormData) {
      const file = fd.get("file") as File;
      const name = file?.name ?? "unknown";
      state.calls.push(name);
      state.folders.push(String(fd.get("folder")));
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      if (name.startsWith("v")) {
        state.heavyPeak = Math.max(state.heavyPeak, state.inFlight);
      }

      setTimeout(() => {
        state.inFlight -= 1;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        const verdict = behaviour(name);
        if (verdict === "network") {
          this.onerror?.();
          return;
        }
        if (verdict === "ok") {
          this.status = 200;
          this.responseText = JSON.stringify({
            key: `k-${name}`,
            url: `https://cdn.test/${name}`,
          });
        } else {
          this.status = verdict;
          this.responseText = JSON.stringify({ error: `rejected ${name}` });
        }
        this.onload?.();
      }, delayMs);
    }
  }

  vi.stubGlobal("XMLHttpRequest", FakeXhr as any);

  // The large-file transport, recording into the SAME counters so a video
  // that moved to multipart still proves the one-at-a-time lane.
  multipartHooks.run = (file, onProgress) =>
    new Promise((resolve, reject) => {
      state.calls.push(file.name);
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      if (file.name.startsWith("v")) {
        state.heavyPeak = Math.max(state.heavyPeak, state.inFlight);
      }
      setTimeout(() => {
        state.inFlight -= 1;
        onProgress?.({
          bytesUploaded: 50,
          totalBytes: 100,
          partsCompleted: 1,
          partsTotal: 2,
        });
        const verdict = behaviour(file.name);
        if (verdict === "ok") {
          resolve({ key: `k-${file.name}`, url: `https://cdn.test/${file.name}` });
          return;
        }
        reject(new Error(verdict === "network" ? "network" : `rejected ${file.name}`));
      }, delayMs);
    });

  return state;
}

const OPTS = { folder: "jobs/1", stamp: null, source: "gallery" as const };

beforeEach(() => { vi.clearAllMocks(); evidenceStore.rows.clear(); evidenceStore.writes = 0; evidenceStore.failAt = 0; });
afterEach(() => vi.unstubAllGlobals());

describe("upload receipt and cleanup integrity", () => {
  it.each([1, 2])("retains original Files when durable batch write %s fails", async failAt => {
    evidenceStore.failAt = failAt;
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_: string, run: () => Promise<unknown>) => run() } });
    installFakeXhr(() => "ok");
    vi.stubGlobal("fetch", vi.fn(async (_url, opts) => { const body = JSON.parse(opts.body); return new Response(JSON.stringify({ ok: true, captureId: body.captureId, key: body.key })); }));
    const files = [fakeFile("first.jpg"), fakeFile("second.jpg")];
    const result = await prepareAndUploadFiles(files, { ...OPTS,
      evidence: { jobId: "job", draftIdentity: "identity", templateId: "template", formRevision: "revision", fieldId: "photo" } });
    expect(result.failedCount).toBe(1); expect(result.failed[0].file).toBe(files[failAt - 1]);
    expect(result.failed[0].captureId).toBeUndefined(); expect(result.failed[0].reason).toContain("Not saved on this device");
    expect(result.results).toHaveLength(1);
  });
  it("persists the whole capture batch first, binds upload namespaces, and retries known receipt attachment without upload", async () => {
    evidenceStore.rows.clear();
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_: string, run: () => Promise<unknown>) => run() } });
    const state = installFakeXhr(() => { expect(evidenceStore.rows.size).toBe(2); return "ok"; });
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async (_url, opts) => {
      const body = JSON.parse(opts.body);
      const stored = evidenceStore.rows.get(body.captureId);
      expect(stored.receipt.key).toBe(body.key); expect(stored.prepared).toBeDefined();
      if (first) { first = false; throw new Error("lost attachment acknowledgement"); }
      return new Response(JSON.stringify({ ok: true, captureId: body.captureId, key: body.key }));
    }));
    const scope = { jobId: "job", draftIdentity: "identity", templateId: "template", formRevision: "revision", fieldId: "photo" };
    const files = [fakeFile("first.jpg"), fakeFile("second.jpg")];
    const result = await prepareAndUploadFiles(files, { ...OPTS, evidence: scope });
    expect(result.failedCount).toBe(1); expect(result.results).toHaveLength(1);
    const rows = Array.from(evidenceStore.rows.values());
    expect(vi.mocked(uploadMultipart).mock.calls.map(call => call[5])).toEqual(rows.map(row => `forms/job/${row.id}`));
    const failed = rows.find(row => row.status === "uploaded");
    const retry = await prepareAndUploadFiles([files[0]], { ...OPTS, evidence: scope, recoveryRecords: [failed] });
    expect(retry.failedCount).toBe(0); expect(state.calls).toEqual(["first.jpg", "second.jpg"]);
    expect(evidenceStore.rows.get(failed.id).status).toBe("attached");
    expect(rows.every(row => row.blob)).toBe(true);
  });
  it("keeps successful videos and continues the lane when temporary cleanup rejects", async () => {
    installFakeXhr(() => "ok");
    vi.mocked(compressVideo).mockResolvedValueOnce({
      file: fakeFile("v-cleanup.mp4", 1024, "video/mp4"),
      dispose: async () => { throw new Error("Storage cleanup failed"); },
    });
    const result = await prepareAndUploadFiles([
      fakeFile("v-cleanup.mp4", 1024, "video/mp4"),
      fakeFile("v-next.mp4", 1024, "video/mp4"),
    ], OPTS);
    expect(result.results.map(item => item.name)).toEqual(["v-cleanup.mp4", "v-next.mp4"]);
    expect(result.failedCount).toBe(0);
  });
  it("does not automatically resend a video below the photo retry size", async () => {
    const state = installFakeXhr(() => "network");
    const result = await prepareAndUploadFiles([fakeFile("v-small.mp4", 1024, "video/mp4")], OPTS);
    expect(state.calls).toEqual(["v-small.mp4"]);
    expect(result.failedCount).toBe(1);
  });
  it.each([{ key: "key" }, { key: 1, url: "https://cdn.test/file" }, { key: "key", url: " " }])("does not attach incomplete multipart receipt %j", async receipt => {
    installFakeXhr(() => "ok");
    vi.mocked(uploadMultipart).mockResolvedValueOnce(receipt as any);
    const result = await prepareAndUploadFiles([fakeFile("v-receipt.mp4", 1024, "video/mp4")], OPTS);
    expect(result.results).toEqual([]);
    expect(result.failed[0].reason).toContain("not attached");
    expect(uploadMultipart).toHaveBeenCalledTimes(1);
  });
  it("does not attach or auto-retry a successful direct response without a usable URL", async () => {
    let sends = 0;
    class IncompleteXhr {
      upload = {};
      status = 200;
      responseText = '{"key":"uploaded-key"}';
      onload?: () => void;
      open() {}
      send() { sends++; queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("XMLHttpRequest", IncompleteXhr);
    const result = await prepareAndUploadFiles([fakeFile("photo.jpg")], OPTS);
    expect(sends).toBe(1);
    expect(result.results).toEqual([]);
    expect(result.failed[0].reason).toContain("not attached");
  });
});

describe("concurrency", () => {
  it("never runs more than four photo uploads at once", async () => {
    const state = installFakeXhr(() => "ok");

    const files = Array.from({ length: 12 }, (_, i) => fakeFile(`p${i}.jpg`));
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results).toHaveLength(12);
    // Unbounded, this peaked at 12 — which was the bug.
    expect(state.peak).toBeLessThanOrEqual(4);
  });

  it("uploads videos one at a time, not three fighting for one uplink", async () => {
    const state = installFakeXhr(() => "ok");

    const videos = Array.from({ length: 4 }, (_, i) =>
      fakeFile(`v${i}.mp4`, 40 * 1024 * 1024, "video/mp4")
    );
    const out = await prepareAndUploadFiles(videos, OPTS);

    expect(out.results).toHaveLength(4);
    expect(state.heavyPeak).toBe(1);
  });

  it("lets photos keep flowing while a video uploads", async () => {
    const state = installFakeXhr(() => "ok");

    const files = [
      fakeFile("v0.mp4", 40 * 1024 * 1024, "video/mp4"),
      ...Array.from({ length: 6 }, (_, i) => fakeFile(`p${i}.jpg`)),
    ];
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results).toHaveLength(7);
    // A single global lane would cap everything at 1 while the video ran.
    expect(state.peak).toBeGreaterThan(1);
  });

  it("returns immediately for an empty batch", async () => {
    const state = installFakeXhr(() => "ok");
    const out = await prepareAndUploadFiles([], OPTS);
    expect(out.results).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });
});

describe("order", () => {
  it("returns results in the order the cleaner picked them", async () => {
    // Later files resolve sooner, so a naive push() would invert them.
    class OrderXhr {
      upload = { onprogress: null as any };
      onload: any = null;
      onerror: any = null;
      ontimeout: any = null;
      onabort: any = null;
      status = 0;
      responseText = "";
      open() {}
      send(fd: FormData) {
        const file = fd.get("file") as File;
        const index = Number(String(file.name).replace(/\D/g, ""));
        setTimeout(
          () => {
            this.status = 200;
            this.responseText = JSON.stringify({
              key: `k${index}`,
              url: `https://cdn.test/${index}`,
            });
            this.onload?.();
          },
          (5 - index) * 4
        );
      }
    }
    vi.stubGlobal("XMLHttpRequest", OrderXhr as any);

    const files = [0, 1, 2, 3].map((i) => fakeFile(`p${i}.jpg`));
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results.map((r) => r.name)).toEqual(["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg"]);
  });

  it("keeps the survivors in order when one in the middle fails", async () => {
    installFakeXhr((name) => (name === "p1.jpg" ? 400 : "ok"));

    const files = [0, 1, 2].map((i) => fakeFile(`p${i}.jpg`));
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results.map((r) => r.name)).toEqual(["p0.jpg", "p2.jpg"]);
  });
});

describe("failures", () => {
  it("names each failed file, why, and hands back the File for retry", async () => {
    installFakeXhr((name) => (name === "bad.jpg" ? 400 : "ok"));

    const bad = fakeFile("bad.jpg");
    const out = await prepareAndUploadFiles([fakeFile("good.jpg"), bad], OPTS);

    // "1 file failed" would leave a cleaner re-picking the whole batch.
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].name).toBe("bad.jpg");
    expect(out.failed[0].reason).toMatch(/rejected bad\.jpg/);
    // The File itself comes back, so Retry does not mean re-picking.
    expect(out.failed[0].file).toBe(bad);
  });

  it("never rejects, so one bad file cannot lose the good ones", async () => {
    installFakeXhr((name) => (name === "a.jpg" ? "network" : "ok"));

    const out = await prepareAndUploadFiles([fakeFile("a.jpg"), fakeFile("b.jpg")], OPTS);
    expect(out.results.map((r) => r.name)).toEqual(["b.jpg"]);
    expect(out.failed[0].reason).toMatch(/network/i);
  });

  it("retries a small file once after a network drop", async () => {
    let calls = 0;
    const state = installFakeXhr(() => {
      calls += 1;
      return calls === 1 ? "network" : "ok";
    });

    const out = await prepareAndUploadFiles([fakeFile("a.jpg")], OPTS);
    expect(out.results).toHaveLength(1);
    expect(state.calls).toHaveLength(2);
  });

  it("does NOT auto-retry a large video — re-sending 100MB is the worse option", async () => {
    const state = installFakeXhr(() => "network");

    const out = await prepareAndUploadFiles(
      [fakeFile("v0.mp4", 100 * 1024 * 1024, "video/mp4")],
      OPTS
    );

    expect(state.calls).toHaveLength(1);
    expect(out.failed).toHaveLength(1);
    // It surfaces for a manual retry instead.
    expect(out.failed[0].file.size).toBe(100 * 1024 * 1024);
  });

  it("does NOT retry a 4xx — the server already said no", async () => {
    const state = installFakeXhr(() => 413);

    const out = await prepareAndUploadFiles([fakeFile("huge.jpg")], OPTS);
    expect(state.calls).toHaveLength(1);
    expect(out.failed[0].reason).toBe("rejected huge.jpg");
  });
});

describe("progress", () => {
  it("uploads a bounded original when browser video compression is unsupported", async () => {
    installFakeXhr(() => "ok");
    const original = fakeFile("walkthrough.mov", 40 * 1024 * 1024, "video/quicktime");
    vi.mocked(compressVideo).mockRejectedValueOnce(new Error("Unsupported codec"));
    const onAdvice = vi.fn();
    const out = await prepareAndUploadFiles([original], { ...OPTS, onAdvice });
    expect(out.failedCount).toBe(0); expect(out.results[0].kind).toBe("video");
    expect(vi.mocked(uploadMultipart).mock.calls.at(-1)?.[0]).toBe(original);
    expect(onAdvice).toHaveBeenCalledWith(original.name, [expect.stringContaining("Uploading the original")]);
  });
  it.each(["", "application/octet-stream"])("sends phone video with generic MIME %s as video for attachment verification", async type => {
    installFakeXhr(() => "ok");
    const original = fakeFile("walkthrough.mov", 1024, type);
    const out = await prepareAndUploadFiles([original], OPTS);
    expect(out.failedCount).toBe(0);
    expect(vi.mocked(uploadMultipart).mock.calls.at(-1)?.[2]).toBe("video/quicktime");
  });
  it("does not upload the original when compression is cancelled", async () => {
    const state = installFakeXhr(() => "ok"); const controller = new AbortController();
    vi.mocked(compressVideo).mockImplementationOnce(async () => { controller.abort(); throw new Error("Cancelled"); });
    const out = await prepareAndUploadFiles([fakeFile("cancel.mp4", 1024, "video/mp4")], { ...OPTS, signal: controller.signal });
    expect(out.results).toEqual([]); expect(state.calls).toEqual([]);
  });
  it("uploads the compressed video and releases temporary storage afterward", async () => {
    installFakeXhr(() => "ok");
    const original = fakeFile("walkthrough.mov", 600 * 1024 * 1024, "video/quicktime");
    const compressed = fakeFile("walkthrough.mp4", 1024, "video/mp4");
    const dispose = vi.fn(async () => {});
    vi.mocked(compressVideo).mockResolvedValueOnce({ file: compressed, dispose });
    const out = await prepareAndUploadFiles([original], OPTS);
    expect(out.failed).toHaveLength(0);
    expect(vi.mocked(uploadMultipart).mock.calls.at(-1)?.[0]).toBe(compressed);
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("retains the original for retry when compression fails without uploading it", async () => {
    const state = installFakeXhr(() => "ok");
    const original = fakeFile("walkthrough.mov", 600 * 1024 * 1024, "video/quicktime");
    vi.mocked(compressVideo).mockRejectedValueOnce(new Error("Unsupported codec"));
    const out = await prepareAndUploadFiles([original], OPTS);
    expect(state.calls).toHaveLength(0);
    expect(out.failed[0]).toMatchObject({ file: original, reason: "Unsupported codec" });
  });

  it("reports every file as it settles, successes and failures alike", async () => {
    installFakeXhr((name) => (name === "p1.jpg" ? 400 : "ok"));

    const seen: Array<[number, number]> = [];
    await prepareAndUploadFiles(
      [0, 1, 2].map((i) => fakeFile(`p${i}.jpg`)),
      { ...OPTS, onProgress: (done, total) => seen.push([done, total]) }
    );

    // A counter that stalls on a failure looks like a hang.
    expect(seen).toHaveLength(3);
    expect(seen[seen.length - 1]).toEqual([3, 3]);
  });

  it("reports bytes in flight, which is what a big video needs", async () => {
    installFakeXhr(() => "ok");

    const frames: number[] = [];
    await prepareAndUploadFiles([fakeFile("v0.mp4", 40 * 1024 * 1024, "video/mp4")], {
      ...OPTS,
      onFileProgress: (inFlight) => {
        for (const item of inFlight) {
          if (item.percent !== null) frames.push(item.percent);
        }
      },
    });

    // 50/100 from the fake progress event.
    expect(frames).toContain(50);
  });
});
