// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
import { evidenceStampBandHeight, maskEvidenceStamp } from "@/lib/ai/provider/stamp-mask";

const stampSource = readFileSync(path.join(process.cwd(), "lib/uploads/stamp.ts"), "utf8");

describe("evidence stamp mask", () => {
  it("is pinned to the stamp geometry in lib/uploads/stamp.ts (update stamp-mask.ts if this fails)", () => {
    for (const line of [
      "const scale = canvas.width / 1000;",
      "const pad = Math.max(14, Math.round(22 * scale));",
      "const timeSize = Math.max(34, Math.round(58 * scale));",
      "const dateSize = Math.max(15, Math.round(24 * scale));",
      "const metaSize = Math.max(13, Math.round(20 * scale));",
      "const lineGap = Math.round(dateSize * 0.32);",
      "const metaLines = [fittedLocation, fittedReference, fittedContext, fittedCapturer].filter(Boolean);",
      "const scrimHeight = blockHeight + pad * 2.2;",
    ]) expect(stampSource).toContain(line);
  });

  it("covers the tallest possible stamp block (four meta lines) with margin, at any width", () => {
    for (const width of [320, 900, 1280, 1600]) {
      const scale = width / 1000;
      const pad = Math.max(14, Math.round(22 * scale));
      const date = Math.max(15, Math.round(24 * scale));
      const gap = Math.round(date * 0.32);
      const tallest = Math.max(34, Math.round(58 * scale)) + gap + date + 4 * (gap + Math.max(13, Math.round(20 * scale))) + pad * 2.2;
      expect(evidenceStampBandHeight(width, 5000)).toBeGreaterThanOrEqual(Math.ceil(tallest));
    }
    expect(evidenceStampBandHeight(1280, 100)).toBe(100);
  });

  it("blacks out the bottom band and keeps the rest of the photo", async () => {
    const source = await sharp({ create: { width: 1280, height: 960, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();
    const masked = await maskEvidenceStamp({ id: "p", mediaType: "image/jpeg", data: source.toString("base64"), evidenceStamp: true });
    expect(masked).toMatchObject({ id: "p", mediaType: "image/jpeg" });
    expect(masked).not.toHaveProperty("evidenceStamp");
    const { data, info } = await sharp(Buffer.from(masked.data, "base64")).raw().toBuffer({ resolveWithObject: true });
    const value = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    const band = evidenceStampBandHeight(1280, 960);
    expect(value(640, 10)).toBeGreaterThan(200);
    expect(value(640, 960 - band - 20)).toBeGreaterThan(200);
    expect(value(20, 960 - band + 10)).toBeLessThan(30);
    expect(value(1270, 955)).toBeLessThan(30);
  });
});
