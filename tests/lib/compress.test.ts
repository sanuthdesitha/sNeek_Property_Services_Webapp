import { describe, it, expect } from "vitest";
import { compressImage } from "@/lib/uploads/compress";

describe("compressImage", () => {
  it("skips non-image types", async () => {
    const file = new File(["hello"], "doc.pdf", { type: "application/pdf" });
    const r = await compressImage(file);
    expect(r.skipped).toBe(true);
    expect(r.blob).toBe(file);
  });

  it("skips images already under threshold", async () => {
    // 100 KB synthetic image — under 800 KB target
    const file = new File([new ArrayBuffer(100 * 1024)], "small.jpg", { type: "image/jpeg" });
    const r = await compressImage(file);
    expect(r.skipped).toBe(true);
  });
});
