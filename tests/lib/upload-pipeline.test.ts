import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

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

import { prepareAndUploadFiles } from "@/components/v2/cleaner/media-capture";

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
  const state = { inFlight: 0, peak: 0, heavyPeak: 0, calls: [] as string[] };

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
  return state;
}

const OPTS = { folder: "jobs/1", stamp: null, source: "gallery" as const };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

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
