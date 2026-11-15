import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { evidenceStampBandHeight } from "@/lib/ai/provider/stamp-mask";
import { ratioValue, type SocialRatio, type SplitLayout } from "./networks";
import { MIN_SHORT_SIDE, type PhotoMeasurements } from "./scoring-rules";
import type { PhotoFieldKind } from "./photo-fields";

/**
 * Image work for the social post generator (2026-11-17), all on the server
 * with sharp, never touching the evidence original:
 *
 * - measure a photo for its score (sharpness, light, contrast, size);
 * - make a NEW derivative: cut off the bottom stamp band (the same geometry
 *   as the stamp, plus 10%: evidenceStampBandHeight) and the top tag strip
 *   (the same geometry as the picture fingerprint), crop to the network's
 *   shape around the centre of interest, re-encode as an sRGB JPEG. sharp
 *   writes no metadata unless asked (`withMetadata` is never called), and
 *   the result is checked: any EXIF, XMP, IPTC or ICC data left refuses it.
 */

const INPUT = { limitInputPixels: 40_000_000, failOn: "error" as const };
export const OUTPUT_WIDTH = 1080;
const MAX_JPEG_BYTES = 8 * 1024 * 1024;

export class SocialImageError extends Error {
  constructor(public code: "UNREADABLE" | "TOO_SMALL" | "METADATA_LEFT" | "TOO_LARGE", message: string) {
    super(message);
    this.name = "SocialImageError";
  }
}

export type CleanRegion = { left: number; top: number; width: number; height: number };

/** The upright photo and the region left once the stamp band and the top strip are cut. */
async function uprightWithRegion(bytes: Buffer): Promise<{ upright: Buffer; width: number; height: number; region: CleanRegion }> {
  let upright: { data: Buffer; info: sharp.OutputInfo };
  try {
    upright = await sharp(bytes, INPUT).rotate().toBuffer({ resolveWithObject: true });
  } catch {
    throw new SocialImageError("UNREADABLE", "The photo could not be read as an image.");
  }
  const { width, height } = upright.info;
  const band = evidenceStampBandHeight(width, height);
  const top = Math.min(Math.round(height * 0.12), Math.max(0, height - band - 8));
  const regionHeight = height - band - top;
  if (regionHeight < 16) throw new SocialImageError("TOO_SMALL", "Too short once the stamp is removed.");
  return { upright: upright.data, width, height, region: { left: 0, top, width, height: regionHeight } };
}

/** The pixel rows a derivative may come from (exported for the stamp-band test). */
export async function cleanRegionOf(bytes: Buffer): Promise<{ width: number; height: number; region: CleanRegion }> {
  const { width, height, region } = await uprightWithRegion(bytes);
  return { width, height, region };
}

/** Measurements for the score, from the region a post could ever show. */
export async function measurePhoto(bytes: Buffer, fieldKind: PhotoFieldKind): Promise<PhotoMeasurements> {
  const { upright, region } = await uprightWithRegion(bytes);
  const grey = await sharp(upright, INPUT).extract(region).greyscale().resize({ width: 1024 }).raw().toBuffer({ resolveWithObject: true });
  const pixels = grey.data;
  let sum = 0;
  let low = 0;
  let high = 0;
  for (let index = 0; index < pixels.length; index++) {
    const value = pixels[index];
    sum += value;
    if (value <= 2) low++;
    if (value >= 253) high++;
  }
  const count = pixels.length || 1;
  const mean = sum / count;
  let squares = 0;
  for (let index = 0; index < pixels.length; index++) squares += (pixels[index] - mean) ** 2;
  const contrast = Math.sqrt(squares / count);
  // Variance of the Laplacian, read from the convolved pixels themselves (sharp's
  // stats() describes the input, not the result of the convolution).
  const laplacian = await sharp(pixels, { raw: { width: grey.info.width, height: grey.info.height, channels: 1 } })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const step = laplacian.info.channels;
  let lapSum = 0;
  let lapSquares = 0;
  let lapCount = 0;
  for (let index = 0; index < laplacian.data.length; index += step) {
    const value = laplacian.data[index];
    lapSum += value;
    lapSquares += value * value;
    lapCount++;
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const laplacianVar = lapCount ? Math.max(0, lapSquares / lapCount - lapMean * lapMean) : 0;
  return {
    fieldKind,
    width: region.width,
    height: region.height,
    laplacianVar,
    meanLuma: mean,
    clipLow: low / count,
    clipHigh: high / count,
    contrast,
  };
}

function cropSize(width: number, height: number, ratio: number): { width: number; height: number } {
  if (width / height > ratio) return { width: Math.round(height * ratio), height };
  return { width, height: Math.round(width / ratio) };
}

async function encodeClean(pipeline: sharp.Sharp): Promise<Buffer> {
  let output = await pipeline.toColorspace("srgb").jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  if (output.length > MAX_JPEG_BYTES) {
    output = await sharp(output, INPUT).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  }
  if (output.length > MAX_JPEG_BYTES) throw new SocialImageError("TOO_LARGE", "The cleaned copy is larger than 8 MB.");
  await assertNoMetadata(output);
  return output;
}

/** Refuses any copy that still carries camera, location or profile data. */
export async function assertNoMetadata(output: Buffer): Promise<void> {
  const meta = await sharp(output, INPUT).metadata();
  if (meta.exif || meta.xmp || meta.iptc || meta.icc) {
    throw new SocialImageError("METADATA_LEFT", "The cleaned copy still carried photo metadata, so it was not used.");
  }
}

export type Derivative = { bytes: Buffer; width: number; height: number; sha256: string };

function finished(bytes: Buffer, width: number, height: number): Derivative {
  return { bytes, width, height, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** A cropped copy of the clean region, shaped `ratio`, at most 1080 px wide (never enlarged). */
async function shapedCrop(bytes: Buffer, ratio: number, maxWidth = OUTPUT_WIDTH): Promise<{ pipeline: sharp.Sharp; width: number; height: number }> {
  const { upright, region } = await uprightWithRegion(bytes);
  if (Math.min(region.width, region.height) < MIN_SHORT_SIDE / 2) {
    throw new SocialImageError("TOO_SMALL", "Too short once the stamp is removed.");
  }
  const crop = cropSize(region.width, region.height, ratio);
  const width = Math.min(maxWidth, crop.width);
  const height = Math.round(width / ratio);
  const pipeline = sharp(upright, INPUT).extract(region).resize(width, height, { fit: "cover", position: sharp.strategy.attention });
  return { pipeline, width, height };
}

export async function makeSocialCrop(bytes: Buffer, ratio: SocialRatio): Promise<Derivative> {
  const shaped = await shapedCrop(bytes, ratioValue(ratio));
  return finished(await encodeClean(shaped.pipeline), shaped.width, shaped.height);
}

/** A small cleaned preview for the office screen (same crop and metadata rules, smaller and faster). */
export async function makeSocialPreview(bytes: Buffer, ratio: SocialRatio): Promise<Buffer> {
  const shaped = await shapedCrop(bytes, ratioValue(ratio), 480);
  const output = await shaped.pipeline.toColorspace("srgb").jpeg({ quality: 78 }).toBuffer();
  await assertNoMetadata(output);
  return output;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}

function labelSvg(width: number, height: number, label: string, corner: "left" | "right"): Buffer {
  const size = Math.max(18, Math.round(width * 0.045));
  const padX = Math.round(size * 0.7);
  const boxWidth = Math.round(label.length * size * 0.62 + padX * 2);
  const boxHeight = Math.round(size * 1.8);
  const x = corner === "left" ? Math.round(size * 0.6) : width - boxWidth - Math.round(size * 0.6);
  const y = Math.round(size * 0.6);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${Math.round(size * 0.3)}" fill="#1E4A38"/>` +
      `<text x="${x + boxWidth / 2}" y="${y + boxHeight * 0.68}" font-family="Georgia, 'DejaVu Serif', serif" font-size="${size}" fill="#FFFFFF" text-anchor="middle">${escapeXml(label)}</text>` +
      `</svg>`,
  );
}

/** One labelled side of a before/after post (also used for the "two slides" layout). */
export async function makeLabelledCrop(bytes: Buffer, ratio: SocialRatio, label: string): Promise<Derivative> {
  const shaped = await shapedCrop(bytes, ratioValue(ratio));
  const base = await shaped.pipeline.toBuffer();
  const composed = sharp(base, INPUT).composite([{ input: labelSvg(shaped.width, shaped.height, label, "left"), top: 0, left: 0 }]);
  return finished(await encodeClean(composed), shaped.width, shaped.height);
}

/** Before and after in one image: side by side or top and bottom, labels drawn by the server. */
export async function makeBeforeAfterSplit(before: Buffer, after: Buffer, ratio: SocialRatio, layout: Exclude<SplitLayout, "SLIDES">): Promise<Derivative> {
  const total = ratioValue(ratio);
  const halfRatio = layout === "SIDE" ? total / 2 : total * 2;
  const halfMax = layout === "SIDE" ? OUTPUT_WIDTH / 2 : OUTPUT_WIDTH;
  const [left, right] = await Promise.all([shapedCrop(before, halfRatio, halfMax), shapedCrop(after, halfRatio, halfMax)]);
  const width = Math.min(left.width, right.width);
  const height = Math.round(width / halfRatio);
  const [leftBytes, rightBytes] = await Promise.all([left.pipeline.toBuffer(), right.pipeline.toBuffer()]);
  const [beforePart, afterPart] = await Promise.all([
    sharp(leftBytes, INPUT).resize(width, height, { fit: "cover" }).toBuffer(),
    sharp(rightBytes, INPUT).resize(width, height, { fit: "cover" }).toBuffer(),
  ]);
  const canvasWidth = layout === "SIDE" ? width * 2 : width;
  const canvasHeight = layout === "SIDE" ? height : height * 2;
  const canvas = sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#FFFFFF" } }).composite([
    { input: beforePart, top: 0, left: 0 },
    { input: afterPart, top: layout === "SIDE" ? 0 : height, left: layout === "SIDE" ? width : 0 },
    { input: labelSvg(canvasWidth, canvasHeight, "Before", "left"), top: 0, left: 0 },
    { input: layout === "SIDE" ? labelSvg(canvasWidth, canvasHeight, "After", "right") : labelSvg(canvasWidth, canvasHeight, "After", "left"), top: layout === "SIDE" ? 0 : height, left: 0 },
  ]);
  const flattened = await canvas.png().toBuffer();
  return finished(await encodeClean(sharp(flattened, INPUT)), canvasWidth, canvasHeight);
}

/** The branded frame: an Estate green band with the brand name and one line of template text. */
export async function makeFramedCrop(bytes: Buffer, ratio: SocialRatio, brandName: string, line: string): Promise<Derivative> {
  const shaped = await shapedCrop(bytes, ratioValue(ratio));
  const base = await shaped.pipeline.toBuffer();
  const bandHeight = Math.round(shaped.height * 0.14);
  const size = Math.round(bandHeight * 0.34);
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${shaped.width}" height="${bandHeight}">` +
      `<rect width="100%" height="100%" fill="#1E4A38"/>` +
      `<text x="${Math.round(size * 0.9)}" y="${Math.round(bandHeight * 0.62)}" font-family="Georgia, 'DejaVu Serif', serif" font-size="${Math.round(size * 1.15)}" fill="#FFFFFF">${escapeXml(brandName.slice(0, 40))}</text>` +
      `<text x="${shaped.width - Math.round(size * 0.9)}" y="${Math.round(bandHeight * 0.62)}" font-family="'DejaVu Sans', Arial, sans-serif" font-size="${size}" fill="#E9D9A6" text-anchor="end">${escapeXml(line.slice(0, 32))}</text>` +
      `</svg>`,
  );
  const composed = sharp(base, INPUT).composite([{ input: svg, top: shaped.height - bandHeight, left: 0 }]);
  return finished(await encodeClean(composed), shaped.width, shaped.height);
}
