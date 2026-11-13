import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { fromZonedTime } from "date-fns-tz";
import { evidenceStampBandHeight } from "@/lib/ai/provider/stamp-mask";

/**
 * Deterministic photo integrity facts (no AI): an exact byte hash, a
 * perceptual hash that survives re-stamping and re-encoding, and the camera
 * capture time when the stored file still carries EXIF. Facts feed flags for
 * a person; they are never a verdict.
 */

export type PhotoIntegrityFacts = {
  contentSha256: string;
  perceptualHash: string;
  capturedAt: Date | null;
  capturedAtSource: "exif-offset" | "exif-local" | null;
};

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * 64-bit difference hash of the photo with the stamp areas cropped away
 * (bottom time/address band; a top strip for the tag and logo), so the same
 * picture stamped again at another time still matches.
 */
export async function perceptualHash(bytes: Buffer): Promise<string> {
  const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate();
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error("Unreadable image size");
  const band = evidenceStampBandHeight(width, height);
  const top = Math.min(Math.round(height * 0.12), Math.max(0, height - band - 8));
  const cropHeight = height - band - top;
  const region = cropHeight >= 16 ? { left: 0, top, width, height: cropHeight } : { left: 0, top: 0, width, height };
  const pixels = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().extract(region)
    .greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? "1" : "0";
  }
  let hex = "";
  for (let index = 0; index < 64; index += 4) hex += parseInt(bits.slice(index, index + 4), 2).toString(16);
  return hex;
}

/** Number of differing bits between two 64-bit hex hashes. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let count = 0;
  for (let index = 0; index < a.length; index++) {
    let nibble = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    while (nibble) { count += nibble & 1; nibble >>= 1; }
  }
  return count;
}

type ExifTime = { local: string; offset: string | null };

/** Minimal TIFF/EXIF reader: DateTimeOriginal (0x9003) and OffsetTimeOriginal (0x9011) only. */
export function readExifCaptureTime(exif: Buffer | undefined): ExifTime | null {
  if (!exif || exif.length < 14) return null;
  const start = exif.subarray(0, 6).toString("latin1") === "Exif\u0000\u0000" ? 6 : 0;
  const tiff = exif.subarray(start);
  const order = tiff.subarray(0, 2).toString("latin1");
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  const u16 = (at: number) => (at + 2 <= tiff.length ? (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)) : -1);
  const u32 = (at: number) => (at + 4 <= tiff.length ? (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)) : -1);
  const entries = (ifd: number) => {
    const count = u16(ifd);
    if (count < 0 || count > 500) return [];
    return Array.from({ length: count }, (_, index) => {
      const at = ifd + 2 + index * 12;
      return { tag: u16(at), type: u16(at + 2), count: u32(at + 4), value: u32(at + 8), at };
    });
  };
  const ascii = (entry: { type: number; count: number; value: number; at: number }) => {
    if (entry.type !== 2 || entry.count <= 0 || entry.count > 64) return null;
    const offset = entry.count <= 4 ? entry.at + 8 : entry.value;
    if (offset < 0 || offset + entry.count > tiff.length) return null;
    return tiff.subarray(offset, offset + entry.count).toString("latin1").replace(/\u0000+$/, "");
  };
  const exifPointer = entries(u32(4)).find((entry) => entry.tag === 0x8769)?.value;
  if (!exifPointer || exifPointer <= 0 || exifPointer >= tiff.length) return null;
  const exifEntries = entries(exifPointer);
  const local = exifEntries.find((entry) => entry.tag === 0x9003);
  const offset = exifEntries.find((entry) => entry.tag === 0x9011);
  const localText = local ? ascii(local) : null;
  if (!localText || !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(localText)) return null;
  const offsetText = offset ? ascii(offset) : null;
  return { local: localText, offset: offsetText && /^[+-]\d{2}:\d{2}$/.test(offsetText) ? offsetText : null };
}

/** EXIF time to an instant: with its own offset, or read in the business time zone (marked as such). */
export function exifInstant(time: ExifTime, timezone: string): { at: Date; source: "exif-offset" | "exif-local" } | null {
  const [date, clock] = time.local.split(" ");
  const iso = `${date.replace(/:/g, "-")}T${clock}`;
  const at = time.offset ? new Date(`${iso}${time.offset}`) : fromZonedTime(iso, timezone);
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() < 2000) return null;
  return { at, source: time.offset ? "exif-offset" : "exif-local" };
}

export async function computePhotoIntegrity(bytes: Buffer, timezone: string): Promise<PhotoIntegrityFacts> {
  const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
  if (!["jpeg", "png", "webp", "gif", "heif", "tiff"].includes(metadata.format ?? "")) throw new Error("Unsupported image");
  const exif = readExifCaptureTime(metadata.exif);
  const captured = exif ? exifInstant(exif, timezone) : null;
  return {
    contentSha256: sha256Hex(bytes),
    perceptualHash: await perceptualHash(bytes),
    capturedAt: captured?.at ?? null,
    capturedAtSource: captured?.source ?? null,
  };
}
