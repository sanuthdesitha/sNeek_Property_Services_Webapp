import "server-only";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getAppSettings } from "@/lib/settings";
import { resolveS3 } from "@/lib/s3";
import { assertSafePublicUrl } from "@/lib/security/ssrf";

const MAX_BYTES = 10 * 1024 * 1024;
export const ICON_SIZES = [32, 64, 180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];
export type AppBrand = { name: string; logo: string; version: string };

export async function getAppBrand(): Promise<AppBrand> {
  const settings = await getAppSettings();
  const name = settings.companyName?.trim() || "sNeek Property Services";
  const logo = settings.logoUrl?.trim() || "";
  return {
    name,
    logo,
    version: createHash("sha256")
      .update(JSON.stringify([name, logo]))
      .digest("hex")
      .slice(0, 16),
  };
}

export function appIconUrl(brand: AppBrand, size: IconSize, maskable = false) {
  return `/icons/${size}?v=${brand.version}${maskable ? "&maskable=1" : ""}`;
}

/** Only the saved public brand asset is exposed; request parameters cannot select a source. */
export async function loadBrandImage(source: string): Promise<Buffer> {
  if (!source || source.startsWith("//")) throw new Error("No brand image");
  let key = source.replace(/^\//, "");
  if (/^https:\/\//i.test(source)) {
    const base = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/, "");
    if (base && source.startsWith(`${base}/`))
      key = decodeURIComponent(source.slice(base.length + 1).split(/[?#]/)[0]);
    else {
      const url = await assertSafePublicUrl(source);
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get("content-length")) > MAX_BYTES
      )
        throw new Error("Brand image unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > MAX_BYTES) throw new Error("Brand image too large");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      return Buffer.concat(chunks);
    }
  }
  if (
    /[:\\\u0000-\u0020]/.test(key) ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid brand image");
  if (key.startsWith("branding/")) {
    const { client, bucket } = await resolveS3();
    const request = client.getObject({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${MAX_BYTES}`,
    });
    const timer = setTimeout(() => request.abort(), 5000);
    try {
      const object = await request.promise();
      const bytes = Buffer.isBuffer(object.Body)
        ? object.Body
        : object.Body instanceof Uint8Array
          ? Buffer.from(object.Body)
          : null;
      if (!bytes || bytes.length > MAX_BYTES)
        throw new Error("Brand image unavailable");
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  }
  // Support a bundled public logo without fetching the app recursively.
  if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(key))
    throw new Error("Invalid brand image");
  const root = await realpath(path.join(process.cwd(), "public"));
  const file = await realpath(path.join(root, key));
  if (!file.startsWith(root + path.sep)) throw new Error("Invalid brand image");
  const bytes = await readFile(file);
  if (bytes.length > MAX_BYTES) throw new Error("Brand image too large");
  return bytes;
}

export async function renderBrandIcon(
  bytes: Buffer,
  size: IconSize,
  maskable: boolean,
) {
  // A 56% square lies inside Android's central 80% safe circle. Apple applies its own corner mask.
  const inset = Math.round(size * (maskable ? 0.56 : 0.86));
  const logo = await sharp(bytes, {
    limitInputPixels: 16_000_000,
    failOn: "error",
  })
    .rotate()
    .resize(inset, inset, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: "#ffffff" },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();
}

const cache = new Map<string, { expires: number; bytes: Buffer }>();
export async function appIconResponse(
  size: IconSize,
  maskable = false,
): Promise<Response> {
  let bytes: Buffer;
  let fallback = false;
  try {
    const brand = await getAppBrand();
    const key = `${brand.version}:${size}:${maskable}`;
    const existing = cache.get(key);
    if (existing && existing.expires > Date.now()) bytes = existing.bytes;
    else {
      bytes = await renderBrandIcon(
        await loadBrandImage(brand.logo),
        size,
        maskable,
      );
      if (cache.size >= 12) cache.delete(cache.keys().next().value!);
      cache.set(key, { bytes, expires: Date.now() + 300_000 });
    }
  } catch {
    fallback = true;
    bytes = await renderBrandIcon(
      await readFile(path.join(process.cwd(), "public/icon-512.png")),
      size,
      maskable,
    );
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": fallback
        ? "no-store"
        : "public, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
