// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: vi.fn(), submission: vi.fn(), earlier: vi.fn(), logs: vi.fn(), pending: vi.fn(), update: vi.fn(), head: vi.fn(), get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {
  job: { findUnique: m.job }, formSubmission: { findFirst: m.submission }, timeLog: { findMany: m.logs },
  submissionMedia: { findMany: (args: { where: { integrityCheckedAt?: null } }) => ("integrityCheckedAt" in args.where ? m.pending(args) : m.earlier(args)), updateMany: m.update },
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/s3", () => ({ resolveS3: async () => ({ bucket: "b", client: { headObject: () => ({ promise: m.head }), getObject: () => ({ promise: m.get }) } }) }));
import sharp from "sharp";
import { buildPhotoIntegrityReport } from "@/lib/media/photo-integrity-flags";
import { processPhotoIntegrityQueue } from "@/lib/media/photo-integrity-queue";

const fact = (id: string, patch: Record<string, unknown> = {}) => ({ id, fieldId: `field_${id}`, label: `Room ${id}`, contentSha256: `sha-${id}`, perceptualHash: "0000000000000000", capturedAt: null, capturedAtSource: null, integrityCheckedAt: new Date(), integrityError: null, ...patch });

beforeEach(() => {
  vi.resetAllMocks();
  m.job.mockResolvedValue({ id: "job-1", propertyId: "prop-1" });
  m.earlier.mockResolvedValue([]); m.logs.mockResolvedValue([]);
});

describe("photo integrity flags", () => {
  it("flags the same file twice and a near-identical picture within the job", async () => {
    m.submission.mockResolvedValue({ media: [
      fact("a", { perceptualHash: "0000000000000000" }),
      fact("b", { contentSha256: "sha-a", perceptualHash: "ffffffffffffffff" }),
      fact("c", { perceptualHash: "0000000000000003" }),
    ] });
    const report = await buildPhotoIntegrityReport("job-1");
    expect(report.flags.map((flag) => [flag.kind, flag.mediaId])).toEqual([["duplicate_in_job", "b"], ["near_duplicate_in_job", "c"]]);
  });

  it("flags reuse from an earlier clean at the same property, scoped by property and excluding this job", async () => {
    m.submission.mockResolvedValue({ media: [fact("a", { perceptualHash: "123456789abcdef0" })] });
    m.earlier.mockResolvedValue([{ id: "old", contentSha256: "other", perceptualHash: "123456789abcdef1", submission: { jobId: "job-0", job: { scheduledDate: new Date("2026-10-02T00:00:00Z") } } }]);
    const report = await buildPhotoIntegrityReport("job-1");
    expect(report.flags).toEqual([expect.objectContaining({ kind: "reused_from_earlier_job", mediaId: "a", relatedJobId: "job-0", detail: expect.stringContaining("2026-10-02") })]);
    expect(m.earlier.mock.calls[0][0].where.submission).toEqual({ job: { propertyId: "prop-1", id: { not: "job-1" } } });
  });

  it("compares camera time with the clock window only when the camera time was recorded", async () => {
    m.logs.mockResolvedValue([{ startedAt: new Date("2026-11-14T00:00:00Z"), stoppedAt: new Date("2026-11-14T02:00:00Z") }]);
    m.submission.mockResolvedValue({ media: [
      fact("early", { capturedAt: new Date("2026-11-13T22:00:00Z"), capturedAtSource: "exif-local", perceptualHash: "00000000000000ff" }),
      fact("inside", { capturedAt: new Date("2026-11-14T01:00:00Z"), perceptualHash: "0000ff0000000000" }),
      fact("grace", { capturedAt: new Date("2026-11-14T02:20:00Z"), perceptualHash: "ff00000000000000" }),
      fact("unknown", { perceptualHash: "00ff00ff00ff00ff" }),
    ] });
    const report = await buildPhotoIntegrityReport("job-1");
    expect(report.flags.filter((flag) => flag.kind === "outside_clock_window").map((flag) => flag.mediaId)).toEqual(["early"]);
    expect(report.flags[0].detail).toContain("no time zone");
    expect(report.counts).toMatchObject({ photos: 4, captureTimeRecorded: 3 });
    expect(report.clockWindow).toMatchObject({ open: false });
  });

  it("keeps unchecked and unreadable photos visible instead of counting them as clean", async () => {
    m.submission.mockResolvedValue({ media: [
      fact("pending", { integrityCheckedAt: null, contentSha256: null, perceptualHash: null }),
      fact("broken", { integrityError: "The photo could not be read as an image.", contentSha256: null, perceptualHash: null }),
    ] });
    const report = await buildPhotoIntegrityReport("job-1");
    expect(report.photos.map((photo) => photo.state)).toEqual(["not_checked", "could_not_check"]);
    expect(report.counts).toMatchObject({ checked: 0, notChecked: 1, couldNotCheck: 1 });
    expect(report.flags).toEqual([]);
  });

  it("reports no submission honestly", async () => {
    m.submission.mockResolvedValue(null);
    expect(await buildPhotoIntegrityReport("job-1")).toMatchObject({ hasSubmission: false, photos: [], flags: [] });
  });
});

describe("media-integrity worker", () => {
  it("stores hashes from the stored photo and marks unreadable or unsupported photos with a fixed reason", async () => {
    const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#777777" } }).jpeg().toBuffer();
    m.pending.mockResolvedValue([
      { id: "ok", s3Key: "forms/job/c/u/photo.jpg", originalS3Key: null },
      { id: "elsewhere", s3Key: "public/photo.jpg", originalS3Key: null },
      { id: "garbage", s3Key: "jobs/job/u/file.jpg", originalS3Key: null },
    ]);
    m.head.mockResolvedValueOnce({ ContentLength: jpeg.length, ETag: "e" }).mockResolvedValueOnce({ ContentLength: 5, ETag: "e" });
    m.get.mockResolvedValueOnce({ Body: jpeg }).mockResolvedValueOnce({ Body: Buffer.from("hello") });
    m.update.mockResolvedValue({ count: 1 });
    expect(await processPhotoIntegrityQueue()).toEqual({ processed: 1, failed: 2 });
    const [ok, elsewhere, garbage] = m.update.mock.calls.map((call) => call[0]);
    expect(ok).toMatchObject({ where: { id: "ok", integrityCheckedAt: null }, data: { contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/), perceptualHash: expect.stringMatching(/^[0-9a-f]{16}$/), capturedAt: null, integrityError: null } });
    expect(elsewhere.data).toMatchObject({ integrityError: "This photo's storage location is not supported for integrity checks.", integrityCheckedAt: expect.any(Date) });
    expect(elsewhere.data.contentSha256).toBeUndefined();
    expect(garbage.data).toMatchObject({ integrityError: "The photo could not be read as an image." });
  });
});
