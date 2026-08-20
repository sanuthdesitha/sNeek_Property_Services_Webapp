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
 * The bug: every file was uploaded at once. A cleaner picking thirty photos on
 * mobile data opened thirty simultaneous POSTs, browsers run about six per
 * host, and the rest died quietly in the socket queue — "random upload issues".
 */

function fakeFile(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

/** Tracks how many uploads are in flight at the same moment. */
function trackingFetch(behaviour: (name: string) => "ok" | number) {
  const state = { inFlight: 0, peak: 0 };
  const impl = vi.fn(async (_url: string, init: any) => {
    const file = (init.body as FormData).get("file") as any;
    const fileName = file?.name ?? "unknown";
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    await new Promise((r) => setTimeout(r, 5));
    state.inFlight -= 1;
    const verdict = behaviour(fileName);
    if (verdict !== "ok") {
      return {
        ok: false,
        status: verdict,
        json: async () => ({ error: `rejected ${fileName}` }),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ key: `k-${fileName}`, url: `https://cdn.test/${fileName}` }),
    } as any;
  });
  return { state, impl };
}

const OPTS = { folder: "jobs/1", stamp: null, source: "library" as const };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("prepareAndUploadFiles — concurrency", () => {
  it("never runs more than three uploads at once", async () => {
    const { state, impl } = trackingFetch(() => "ok");
    vi.stubGlobal("fetch", impl);

    const files = Array.from({ length: 12 }, (_, i) => fakeFile(`p${i}.jpg`));
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results).toHaveLength(12);
    // Unbounded, this peaked at 12 — which is the bug.
    expect(state.peak).toBeLessThanOrEqual(3);
  });

  it("still uploads everything when there are fewer files than slots", async () => {
    const { impl } = trackingFetch(() => "ok");
    vi.stubGlobal("fetch", impl);

    const out = await prepareAndUploadFiles([fakeFile("only.jpg")], OPTS);
    expect(out.results).toHaveLength(1);
    expect(out.failed).toEqual([]);
  });

  it("returns immediately for an empty batch without calling the server", async () => {
    const { impl } = trackingFetch(() => "ok");
    vi.stubGlobal("fetch", impl);

    const out = await prepareAndUploadFiles([], OPTS);
    expect(out.results).toEqual([]);
    expect(impl).not.toHaveBeenCalled();
  });
});

describe("prepareAndUploadFiles — order", () => {
  it("returns results in the order the cleaner picked them, not the order the network finished", async () => {
    // Later files resolve sooner, so a naive push() would invert them.
    const impl = vi.fn(async (_url: string, init: any) => {
      const file = (init.body as FormData).get("file") as any;
      const index = Number(String(file.name).replace(/\D/g, ""));
      await new Promise((r) => setTimeout(r, (5 - index) * 4));
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: `k${index}`, url: `https://cdn.test/${index}` }),
      } as any;
    });
    vi.stubGlobal("fetch", impl);

    const files = [0, 1, 2, 3].map((i) => fakeFile(`p${i}.jpg`));
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results.map((r) => r.name)).toEqual(["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg"]);
  });

  it("keeps the survivors in order when one in the middle fails", async () => {
    const { impl } = trackingFetch((name) => (name === "p1.jpg" ? 400 : "ok"));
    vi.stubGlobal("fetch", impl);

    const files = [0, 1, 2].map((i) => fakeFile(`p${i}.jpg`));
    const out = await prepareAndUploadFiles(files, OPTS);

    expect(out.results.map((r) => r.name)).toEqual(["p0.jpg", "p2.jpg"]);
  });
});

describe("prepareAndUploadFiles — failures", () => {
  it("names each file that failed and why", async () => {
    const { impl } = trackingFetch((name) => (name === "bad.jpg" ? 400 : "ok"));
    vi.stubGlobal("fetch", impl);

    const out = await prepareAndUploadFiles([fakeFile("good.jpg"), fakeFile("bad.jpg")], OPTS);

    // "1 file failed" would leave a cleaner re-picking the whole batch.
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].name).toBe("bad.jpg");
    expect(out.failed[0].reason).toMatch(/rejected bad\.jpg/);
    expect(out.failedCount).toBe(1);
  });

  it("never rejects, so one bad file cannot lose the good ones", async () => {
    const impl = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", impl);

    const out = await prepareAndUploadFiles([fakeFile("a.jpg")], OPTS);
    expect(out.results).toEqual([]);
    expect(out.failed[0].reason).toMatch(/network down/);
  });

  it("retries a 5xx once, because mobile connections drop mid-POST", async () => {
    let calls = 0;
    const impl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 503, json: async () => ({}) } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: "k", url: "https://cdn.test/a" }),
      } as any;
    });
    vi.stubGlobal("fetch", impl);

    const out = await prepareAndUploadFiles([fakeFile("a.jpg")], OPTS);
    expect(out.results).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("does NOT retry a 4xx — the server already said no", async () => {
    let calls = 0;
    const impl = vi.fn(async () => {
      calls += 1;
      return { ok: false, status: 413, json: async () => ({ error: "too large" }) } as any;
    });
    vi.stubGlobal("fetch", impl);

    const out = await prepareAndUploadFiles([fakeFile("huge.jpg")], OPTS);
    expect(calls).toBe(1);
    expect(out.failed[0].reason).toBe("too large");
  });
});

describe("prepareAndUploadFiles — progress", () => {
  it("reports every file as it settles, successes and failures alike", async () => {
    const { impl } = trackingFetch((name) => (name === "p1.jpg" ? 400 : "ok"));
    vi.stubGlobal("fetch", impl);

    const seen: Array<[number, number]> = [];
    await prepareAndUploadFiles(
      [0, 1, 2].map((i) => fakeFile(`p${i}.jpg`)),
      { ...OPTS, onProgress: (done, total) => seen.push([done, total]) }
    );

    // A counter that stalls on a failure looks like a hang.
    expect(seen).toHaveLength(3);
    expect(seen[seen.length - 1]).toEqual([3, 3]);
  });
});
