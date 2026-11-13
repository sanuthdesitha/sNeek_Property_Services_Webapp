import "server-only";
import sharp from "sharp";
import type { ProviderImage } from "./types";

/**
 * Height of the bottom band that can hold the evidence stamp burned in by
 * `lib/uploads/stamp.ts` (time, date, weekday and up to four meta lines,
 * starting with the street address, on a full-width scrim).
 *
 * The geometry mirrors stamp.ts: every size scales with width / 1000 and has a
 * pixel minimum. Images only shrink after stamping (adaptive JPEG encoding and
 * the server's 1280 px resize), so evaluating the minimums at the CURRENT width
 * gives an equal or larger fraction of the image than the original stamp: the
 * band is conservative. A 10% margin covers rounding and text shadows.
 * `tests/lib/ai-stamp-mask.test.ts` pins these constants to stamp.ts.
 */
export function evidenceStampBandHeight(width: number, height: number): number {
  const scale = width / 1000;
  const pad = Math.max(14, Math.round(22 * scale));
  const timeSize = Math.max(34, Math.round(58 * scale));
  const dateSize = Math.max(15, Math.round(24 * scale));
  const metaSize = Math.max(13, Math.round(20 * scale));
  const lineGap = Math.round(dateSize * 0.32);
  const maxMetaLines = 4;
  const blockHeight = timeSize + lineGap + dateSize + maxMetaLines * (lineGap + metaSize);
  const scrimHeight = blockHeight + pad * 2.2;
  return Math.min(height, Math.ceil(scrimHeight * 1.1));
}

/** Blacks out the stamp band before an evidence photo leaves the server for a cloud provider. */
export async function maskEvidenceStamp(image: ProviderImage): Promise<ProviderImage> {
  const input = Buffer.from(image.data, "base64");
  const metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Could not read the photo size to hide its stamp.");
  const band = evidenceStampBandHeight(metadata.width, metadata.height);
  const output = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error" })
    .composite([{ input: { create: { width: metadata.width, height: band, channels: 3, background: "#000000" } }, top: metadata.height - band, left: 0 }])
    .jpeg({ quality: 80 })
    .toBuffer();
  return { id: image.id, mediaType: "image/jpeg", data: output.toString("base64") };
}
