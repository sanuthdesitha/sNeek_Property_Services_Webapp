import sharp from "sharp";
import { evidenceStampBandHeight } from "@/lib/ai/provider/stamp-mask";

/**
 * Fixture photos for the social post generator tests: a deterministic
 * textured "room" (seeded, so scores are reproducible), optionally blurred
 * or darkened, with a magenta band where the evidence stamp sits and a cyan
 * strip where the top tag sits (so a test can prove neither survives the
 * crop), and EXIF/GPS written into the file.
 */

export const STAMP_COLOUR = { r: 255, g: 0, b: 255 };
export const TAG_COLOUR = { r: 0, g: 255, b: 255 };

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export type FixturePhotoOptions = { width?: number; height?: number; seed?: number; blur?: number; brightness?: number; stamp?: boolean; exif?: boolean };

export async function makeFixturePhoto(options: FixturePhotoOptions = {}): Promise<Buffer> {
  const width = options.width ?? 1200;
  const height = options.height ?? 1600;
  const random = seeded(options.seed ?? 7);
  const pixels = Buffer.alloc(width * height * 3);
  // Large soft regions (walls, furniture) with fine texture on top.
  const blocks = Array.from({ length: 14 }, () => ({ x: random() * width, y: random() * height, w: 80 + random() * 500, h: 80 + random() * 500, c: [60 + random() * 160, 60 + random() * 160, 60 + random() * 160] }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let colour = [150, 140, 130];
      for (const block of blocks) if (x >= block.x && x < block.x + block.w && y >= block.y && y < block.y + block.h) colour = block.c;
      const grain = ((x * 7 + y * 13) % 17) * 3 - 24;
      const index = (y * width + x) * 3;
      pixels[index] = Math.max(0, Math.min(255, colour[0] + grain));
      pixels[index + 1] = Math.max(0, Math.min(255, colour[1] + grain));
      pixels[index + 2] = Math.max(0, Math.min(255, colour[2] + grain));
    }
  }
  let image = sharp(pixels, { raw: { width, height, channels: 3 } });
  if (options.blur) image = image.blur(options.blur);
  if (options.brightness !== undefined) image = image.linear(options.brightness, 0);
  let base = await image.png().toBuffer();
  if (options.stamp !== false) {
    const band = evidenceStampBandHeight(width, height);
    const stampHeight = Math.round(band * 0.8);
    const tagHeight = Math.round(height * 0.05);
    base = await sharp(base)
      .composite([
        { input: { create: { width, height: stampHeight, channels: 3, background: STAMP_COLOUR } }, top: height - stampHeight, left: 0 },
        { input: { create: { width: Math.round(width * 0.4), height: tagHeight, channels: 3, background: TAG_COLOUR } }, top: Math.round(height * 0.02), left: 0 },
      ])
      .png()
      .toBuffer();
  }
  const jpeg = sharp(base).jpeg({ quality: 90 });
  if (options.exif !== false) {
    jpeg.withMetadata({ exif: { IFD0: { Make: "FixtureCam", Model: "Test 1" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "33/1 53/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "151/1 16/1 0/1" } } });
  }
  return jpeg.toBuffer();
}

/** Share of pixels close to the given colour (JPEG noise allowed). */
export async function colourShare(bytes: Buffer, colour: { r: number; g: number; b: number }): Promise<number> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let hits = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    if (Math.abs(data[index] - colour.r) < 50 && Math.abs(data[index + 1] - colour.g) < 50 && Math.abs(data[index + 2] - colour.b) < 50) hits++;
  }
  return hits / (data.length / info.channels);
}
