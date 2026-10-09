// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  storage: vi.fn(),
  safeUrl: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings }));
vi.mock("@/lib/s3", () => ({ resolveS3: mocks.storage }));
vi.mock("@/lib/security/ssrf", () => ({ assertSafePublicUrl: mocks.safeUrl }));
import {
  appIconResponse,
  appIconUrl,
  getAppBrand,
  loadBrandImage,
  renderBrandIcon,
} from "@/lib/branding/app-icons";
import { GET as manifest } from "@/app/manifest.json/route";
import { GET as iconRoute } from "@/app/icons/[size]/route";
import { GET as favicon } from "@/app/favicon.ico/route";
import Icon from "@/app/icon";
let red: Buffer;
beforeEach(async () => {
  vi.resetAllMocks();
  red = await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  mocks.settings.mockResolvedValue({
    companyName: "Test property services",
    logoUrl: `branding/logo-${Math.random()}.png`,
  });
  mocks.storage.mockResolvedValue({
    bucket: "brand",
    client: {
      getObject: () => ({
        promise: async () => ({ Body: red }),
        abort: vi.fn(),
      }),
    },
  });
  mocks.safeUrl.mockImplementation(async (url) => new URL(url));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("versions icon URLs when the saved logo changes, without exposing the source URL", async () => {
  const first = await getAppBrand();
  mocks.settings.mockResolvedValue({
    companyName: first.name,
    logoUrl: "branding/replacement.png",
  });
  const next = await getAppBrand();
  expect(next.version).not.toBe(first.version);
  expect(appIconUrl(next, 180)).toMatch(/^\/icons\/180\?v=[a-f0-9]{16}$/);
});
it("generates true opaque PNGs at browser, Apple and Android sizes without stretching the logo", async () => {
  for (const size of [32, 64, 180, 192, 512] as const) {
    const response = await appIconResponse(size);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await sharp(bytes).metadata()).toMatchObject({
      format: "png",
      width: size,
      height: size,
    });
    const { data, info } = await sharp(bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) =>
      Array.from(
        data.subarray(
          (y * size + x) * info.channels,
          (y * size + x) * info.channels + 3,
        ),
      );
    expect(pixel(0, 0)).toEqual([255, 255, 255]);
    expect(pixel(Math.floor(size / 2), Math.floor(size / 2))).toEqual([
      255, 0, 0,
    ]);
    expect(pixel(Math.floor(size / 2), Math.floor(size / 8))).toEqual([
      255, 255, 255,
    ]);
  }
});
it("keeps Android maskable artwork inside the central safe circle", async () => {
  const bytes = await renderBrandIcon(red, 512, true);
  const { data, info } = await sharp(bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
      if (data[(y * 512 + x) * info.channels + 1] < 250)
        expect(Math.hypot(x - 256, y - 256)).toBeLessThan(512 * 0.4);
    }
});
it("keeps manifest identity stable with versioned regular and separate maskable icons", async () => {
  const response = await manifest();
  const body = await response.json();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(body).toMatchObject({
    id: "/",
    start_url: "/",
    scope: "/",
    name: "Test property services",
  });
  expect(body.icons.map((item: { purpose: string }) => item.purpose)).toEqual([
    "any",
    "any",
    "maskable",
  ]);
  expect(body.icons[2].src).toContain("maskable=1");
});
it("serves existing icon entry points and rejects unsupported dimensions", async () => {
  expect(
    await sharp(Buffer.from(await (await favicon()).arrayBuffer())).metadata(),
  ).toMatchObject({ width: 32 });
  expect(
    await sharp(Buffer.from(await (await Icon()).arrayBuffer())).metadata(),
  ).toMatchObject({ width: 64 });
  expect(
    (
      await iconRoute(new Request("https://app.example/icons/9"), {
        params: { size: "9" },
      })
    ).status,
  ).toBe(404);
  const response = await iconRoute(
    new Request("https://app.example/icons/180"),
    { params: { size: "180" } },
  );
  expect(response.status).toBe(200);
});
it("falls back to a valid icon during settings or storage failure without caching the failure", async () => {
  mocks.settings.mockRejectedValue(new Error("offline"));
  const response = await appIconResponse(180);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(
    await sharp(Buffer.from(await response.arrayBuffer())).metadata(),
  ).toMatchObject({ width: 180 });
  expect((await (await manifest()).json()).name).toBe(
    "sNeek Property Services",
  );
});
it("bounds remote reads, rejects redirects and checks public URL safety", async () => {
  const fetcher = vi.fn(
    async () => new Response(red, { headers: { "content-type": "image/png" } }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await loadBrandImage("https://cdn.example/logo.png")).toEqual(red);
  expect(mocks.safeUrl).toHaveBeenCalledWith("https://cdn.example/logo.png");
  expect(fetcher).toHaveBeenCalledWith(
    new URL("https://cdn.example/logo.png"),
    expect.objectContaining({ redirect: "manual", cache: "no-store" }),
  );
  fetcher.mockImplementation(async () => new Response(null, { status: 302 }));
  await expect(
    loadBrandImage("https://cdn.example/logo.png"),
  ).rejects.toThrow();
  mocks.safeUrl.mockRejectedValue(new Error("URL not allowed"));
  await expect(loadBrandImage("https://127.0.0.1/logo.png")).rejects.toThrow(
    "URL not allowed",
  );
});
it.each([
  "//private/logo.png",
  "../secret.png",
  "/branding/../secret.png",
  "http://localhost/logo.png",
  "data:image/png;base64,abc",
])("rejects unsafe configured image %s", async (source) => {
  await expect(loadBrandImage(source)).rejects.toThrow();
});
it("reads branding objects from a configured CDN through private storage, including encoded keys", async () => {
  vi.stubEnv("S3_PUBLIC_BASE_URL", "https://cdn.example/assets");
  expect(
    await loadBrandImage("https://cdn.example/assets/branding/a%2Fb.png"),
  ).toEqual(red);
  expect(mocks.storage).toHaveBeenCalled();
  expect(mocks.safeUrl).not.toHaveBeenCalled();
});

it("loads bundled logos and rejects missing assets without exposing another filesystem directory", async () => {
  expect(await sharp(await loadBrandImage("/icon-192.png")).metadata()).toMatchObject({ width: 192 });
  await expect(loadBrandImage("/missing-brand.png")).rejects.toThrow();
  await expect(loadBrandImage("/package.json")).rejects.toThrow();
});
it("bounds oversized storage and HTTP objects before decoding", async () => {
  mocks.storage.mockResolvedValue({ bucket: "brand", client: { getObject: () => ({ promise: async () => ({ Body: Buffer.alloc(10 * 1024 * 1024 + 1) }), abort: vi.fn() }) } });
  await expect(loadBrandImage("branding/large.png")).rejects.toThrow();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { headers: { "content-length": String(11 * 1024 * 1024) } })));
  await expect(loadBrandImage("https://cdn.example/large.png")).rejects.toThrow();
});
it("reuses only successful renders and returns a valid fallback for undecodable saved images", async () => {
  await appIconResponse(192); await appIconResponse(192);
  expect(mocks.storage).toHaveBeenCalledTimes(1);
  mocks.settings.mockResolvedValue({ companyName: "Corrupt brand", logoUrl: "branding/bad.png" });
  mocks.storage.mockResolvedValue({ bucket: "brand", client: { getObject: () => ({ promise: async () => ({ Body: Buffer.from("not an image") }), abort: vi.fn() }) } });
  const response = await appIconResponse(180);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await sharp(Buffer.from(await response.arrayBuffer())).metadata()).toMatchObject({ width: 180 });
});
