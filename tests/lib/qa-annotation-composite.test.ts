import { describe, expect, it, vi } from "vitest";

// sharp and the S3 client are irrelevant to the pure helpers under test, and
// importing them for real makes this suite slow and environment-dependent.
vi.mock("sharp", () => ({ default: vi.fn() }));
vi.mock("@/lib/s3", () => ({ s3: { getObject: vi.fn(), putObject: vi.fn() } }));

import {
  displayKeyFor,
  normalizeQaPhotoRefs,
  type QaPhotoRef,
} from "@/lib/qa/annotation-composite";

/**
 * The rule these protect: `annotatedKey` is a TRANSPARENT overlay holding only
 * QA's marks. Displaying it on its own shows strokes on nothing in a browser,
 * and — because the PDF pipeline re-encodes to JPEG, which has no alpha — a
 * solid black tile covering the photo in a report. Only `flatKey` (the
 * composite) or the original `key` may ever be shown.
 */

describe("normalizeQaPhotoRefs", () => {
  it("reads the current shape", () => {
    expect(
      normalizeQaPhotoRefs([
        { key: "orig.jpg", annotatedKey: "ov.png", flatKey: "flat.jpg", comment: "grout" },
      ])
    ).toEqual([{ key: "orig.jpg", annotatedKey: "ov.png", flatKey: "flat.jpg", comment: "grout" }]);
  });

  it("tolerates the legacy bare-string shape", () => {
    expect(normalizeQaPhotoRefs(["orig.jpg"])).toEqual([{ key: "orig.jpg" }]);
  });

  it("tolerates pre-flattening rows (key + overlay, no composite)", () => {
    expect(normalizeQaPhotoRefs([{ key: "orig.jpg", annotatedKey: "ov.png" }])).toEqual([
      { key: "orig.jpg", annotatedKey: "ov.png", flatKey: null, comment: null },
    ]);
  });

  it("drops entries with no usable key rather than emitting broken refs", () => {
    expect(normalizeQaPhotoRefs([{ annotatedKey: "ov.png" }, "", "   ", null, 42])).toEqual([]);
  });

  it("returns empty for anything that is not an array", () => {
    expect(normalizeQaPhotoRefs(null)).toEqual([]);
    expect(normalizeQaPhotoRefs({ key: "orig.jpg" })).toEqual([]);
    expect(normalizeQaPhotoRefs(undefined)).toEqual([]);
  });
});

describe("displayKeyFor", () => {
  it("prefers the flattened composite", () => {
    const ref: QaPhotoRef = { key: "orig.jpg", annotatedKey: "ov.png", flatKey: "flat.jpg" };
    expect(displayKeyFor(ref)).toBe("flat.jpg");
  });

  it("NEVER returns the bare overlay — falls back to the original photo", () => {
    // This is the whole defect: preferring annotatedKey put marks-on-transparency
    // in front of admins and a black tile in every PDF.
    const ref: QaPhotoRef = { key: "orig.jpg", annotatedKey: "ov.png", flatKey: null };
    expect(displayKeyFor(ref)).toBe("orig.jpg");
    expect(displayKeyFor(ref)).not.toBe("ov.png");
  });

  it("returns the original when there is no annotation at all", () => {
    expect(displayKeyFor({ key: "orig.jpg" })).toBe("orig.jpg");
  });

  it("treats an empty-string flatKey as absent", () => {
    expect(displayKeyFor({ key: "orig.jpg", flatKey: "" })).toBe("orig.jpg");
  });
});
