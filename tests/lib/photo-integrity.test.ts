// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { computePhotoIntegrity, exifInstant, hammingDistance, perceptualHash, readExifCaptureTime, sha256Hex } from "@/lib/media/photo-integrity";

/** A synthetic "room" photo: gradient walls and a dark object, plus a bottom band standing in for the stamp. */
async function roomPhoto(options: { stampColour: string; objectX: number; quality?: number }) {
  const width = 1280; const height = 960;
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4efe6"/><stop offset="1" stop-color="#6b6b6b"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="${options.objectX}" y="300" width="260" height="240" fill="#1f2a44"/>
    <circle cx="900" cy="250" r="90" fill="#c9a227"/>
    <rect x="0" y="${height - 300}" width="${width}" height="300" fill="${options.stampColour}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: options.quality ?? 85 }).toBuffer();
}

describe("photo integrity facts", () => {
  it("hashes bytes exactly", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("gives the same picture with a different stamp (and re-encoding) nearly the same perceptual hash", async () => {
    const first = await perceptualHash(await roomPhoto({ stampColour: "#000000", objectX: 200 }));
    const restamped = await perceptualHash(await roomPhoto({ stampColour: "#ffffff", objectX: 200, quality: 60 }));
    const different = await perceptualHash(await roomPhoto({ stampColour: "#000000", objectX: 820 }));
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingDistance(first, restamped)).toBeLessThanOrEqual(2);
    expect(hammingDistance(first, different)).toBeGreaterThan(6);
  });

  it("counts differing bits and treats different lengths as no match", () => {
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
    expect(hammingDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hammingDistance("ff", "ffff")).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads EXIF capture time with its offset, or in the business time zone without one", async () => {
    const withOffset = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).jpeg()
      .withExif({ IFD2: { DateTimeOriginal: "2026:11:14 09:30:00", OffsetTimeOriginal: "+11:00" } }).toBuffer();
    const facts = await computePhotoIntegrity(withOffset, "Australia/Sydney");
    expect(facts.capturedAt?.toISOString()).toBe("2026-11-13T22:30:00.000Z");
    expect(facts.capturedAtSource).toBe("exif-offset");
    expect(exifInstant({ local: "2026:07:01 09:00:00", offset: null }, "Australia/Sydney")).toEqual({ at: new Date("2026-06-30T23:00:00.000Z"), source: "exif-local" });
  });

  it("records no capture time when the file has no camera data (never a guess)", async () => {
    const plain = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#808080" } }).jpeg().toBuffer();
    expect(await computePhotoIntegrity(plain, "Australia/Sydney")).toMatchObject({ capturedAt: null, capturedAtSource: null });
    expect(readExifCaptureTime(Buffer.from("not exif"))).toBeNull();
    expect(readExifCaptureTime(undefined)).toBeNull();
  });

  it("rejects bytes that are not an image", async () => {
    await expect(computePhotoIntegrity(Buffer.from("plain text"), "Australia/Sydney")).rejects.toThrow();
  });
});
