// @vitest-environment node
/**
 * Lost and found photos (owner report: "Lost and found images doesn't show").
 * Root cause: items store a public bucket link, the bucket is used privately
 * everywhere else, and the screens' fallback (/api/uploads/access) refuses
 * cleaners (job-scoped keys only), while the cleaner gallery had no fallback.
 * Every screen now shows photos through the item's photo route, which re-checks
 * who may open the item and redirects to a fresh signed link.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findUnique: vi.fn(),
  sign: vi.fn(),
  resolve: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { lostFoundItem: { findUnique: m.findUnique } } }));
vi.mock("@/lib/s3", () => ({ getPresignedDownloadUrl: m.sign, resolveS3: m.resolve, publicUrl: (key: string) => `https://public.invalid/${key}` }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/portal-access", () => ({ isCleanerModuleEnabled: (settings: { lostFound?: boolean }) => settings.lostFound !== false }));

import { GET } from "@/app/api/lost-found/[id]/photo/route";
import { serializeItemRow } from "@/lib/lost-found/service";
import { lostFoundPhotoRetrySrc, lostFoundPhotoSrc } from "@/lib/lost-found/photo-src";

const KEY = "lost-found/cleaner-1/a b.jpg";
const item = { id: "item-1", reportedByUserId: "cleaner-1", photos: [{ url: `https://public.invalid/${KEY}`, key: KEY }] };
const request = (key: string) => new NextRequest(`https://app.invalid${lostFoundPhotoSrc("item-1", key)}`);
const call = (key = KEY) => GET(request(key), { params: { id: "item-1" } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  m.requireRole.mockResolvedValue({ user: { id: "office", role: "ADMIN" } });
  m.findUnique.mockResolvedValue(item);
  m.resolve.mockResolvedValue({ bucket: "private-bucket" });
  m.sign.mockResolvedValue("https://storage.invalid/signed?sig=1");
  m.settings.mockResolvedValue({ lostFound: true });
});

describe("lost and found photo route", () => {
  it("redirects the office to a short-lived signed link for the item's own photo", async () => {
    const response = await call();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://storage.invalid/signed?sig=1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.sign).toHaveBeenCalledWith(KEY, 600);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER", "CLEANER"]);
  });

  it("lets the reporting cleaner see their photo (the old fallback refused every cleaner)", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "cleaner-1", role: "CLEANER" } });
    expect((await call()).status).toBe(302);
  });

  it("refuses another cleaner, and the reporter when the module is off", async () => {
    m.requireRole.mockResolvedValue({ user: { id: "cleaner-2", role: "CLEANER" } });
    expect((await call()).status).toBe(403);
    m.requireRole.mockResolvedValue({ user: { id: "cleaner-1", role: "CLEANER" } });
    m.settings.mockResolvedValue({ lostFound: false });
    expect((await call()).status).toBe(403);
    expect(m.sign).not.toHaveBeenCalled();
  });

  it("never signs a key that is not one of the item's photos", async () => {
    const response = await call("jobs/other/secret.jpg");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "PHOTO_NOT_ON_ITEM" });
    expect(m.sign).not.toHaveBeenCalled();
    expect((await call("../x")).status).toBe(400);
  });

  it("answers 404 for a missing item and passes the session guard's refusal through", async () => {
    m.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await call()).status).toBe(403);
  });

  it("falls back to the public link only when a public base URL is configured, else says storage is unavailable", async () => {
    m.resolve.mockResolvedValue({ bucket: "" });
    const unavailable = await call();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: "STORAGE_UNAVAILABLE" });

    vi.stubEnv("S3_PUBLIC_BASE_URL", "https://public.invalid");
    const fallback = await call();
    expect(fallback.status).toBe(302);
    expect(fallback.headers.get("location")).toBe("https://public.invalid/lost-found/cleaner-1/a%20b.jpg");
  });
});

describe("serialized items show photos through the route", () => {
  it("adds src for every photo and keeps the stored url", () => {
    const row = serializeItemRow({ ...item, propertyId: null, jobId: null, resolvedByUserId: null, reservationId: null, createdAt: new Date(), updatedAt: new Date() } as never, {
      properties: new Map(), clients: new Map(), users: new Map(), jobs: new Map(), bookings: new Map(),
    });
    expect(row.photos).toEqual([{ url: `https://public.invalid/${KEY}`, key: KEY, caption: null, src: "/api/lost-found/item-1/photo?key=lost-found%2Fcleaner-1%2Fa%20b.jpg" }]);
  });

  it("a retry asks the route again with a new attempt number", () => {
    const src = lostFoundPhotoSrc("item-1", KEY);
    expect(lostFoundPhotoRetrySrc(src, 0)).toBe(src);
    expect(lostFoundPhotoRetrySrc(src, 2)).toBe(`${src}&attempt=2`);
  });
});
