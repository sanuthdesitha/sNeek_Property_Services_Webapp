import { describe, it, expect } from "vitest";
import {
  normalizeBarcode,
  isValidGtin,
  gtinCheckDigit,
  unitsPerScan,
  tallyScans,
} from "@/lib/inventory/barcodes";

/**
 * The failure this module exists to prevent: the same physical product scans
 * as twelve digits from a UPC-A label and thirteen from an EAN-13 one, the
 * only difference being a leading zero. Stored raw, one tin becomes two items,
 * each holding half the stock and each triggering its own reorder.
 */
describe("normalizeBarcode", () => {
  it("collapses UPC-A and EAN-13 of the same product onto one key", () => {
    // The whole bug, in one assertion.
    const upcA = normalizeBarcode("036000291452");
    const ean13 = normalizeBarcode("0036000291452");
    expect(upcA.kind).toBe("GTIN");
    expect(ean13.kind).toBe("GTIN");
    expect(upcA.code).toBe(ean13.code);
    expect(upcA.code).toHaveLength(14);
  });

  it("accepts a real EAN-13", () => {
    const out = normalizeBarcode("9300675024235");
    expect(out.kind).toBe("GTIN");
    expect(out.code).toBe("09300675024235");
  });

  it("strips the spaces and hyphens printed on packaging", () => {
    // Hand-typed codes arrive exactly as they are printed. Refusing them pushes
    // people to skip the barcode and type a quantity instead.
    expect(normalizeBarcode(" 036000-291452 ").code).toBe(normalizeBarcode("036000291452").code);
  });

  it("rejects a misread rather than counting it against the wrong product", () => {
    // 036000291453 is one digit off a real code — exactly what a bad read looks
    // like. Silently accepting it is worse than not counting at all.
    const out = normalizeBarcode("036000291453");
    expect(out.kind).toBe("INVALID");
    expect(out.reason).toBe("BAD_CHECK_DIGIT");
    expect(out.code).toBe("");
  });

  it("rejects a numeric string that is not a GTIN length", () => {
    expect(normalizeBarcode("12345").reason).toBe("BAD_LENGTH");
    expect(normalizeBarcode("1234567890123456").reason).toBe("BAD_LENGTH");
  });

  it("passes an asset tag through as an opaque key", () => {
    // CODE_128 and QR labels are unique keys with no arithmetic to check.
    const out = normalizeBarcode("sneek-asset-0042");
    expect(out.kind).toBe("OPAQUE");
    expect(out.code).toBe("SNEEK-ASSET-0042");
  });

  it("treats nothing as nothing", () => {
    expect(normalizeBarcode("").reason).toBe("EMPTY");
    expect(normalizeBarcode("   ").reason).toBe("EMPTY");
    expect(normalizeBarcode(null).reason).toBe("EMPTY");
    expect(normalizeBarcode(undefined).reason).toBe("EMPTY");
    expect(normalizeBarcode(12345 as unknown).reason).toBe("EMPTY");
  });
});

describe("gtinCheckDigit", () => {
  it("computes the digit the standard specifies", () => {
    expect(gtinCheckDigit("03600029145")).toBe(2);
    expect(gtinCheckDigit("930067502423")).toBe(5);
  });

  it("weights from the right, not the left", () => {
    // Anchoring the 3,1,3,1 weighting on the left silently inverts it for
    // odd-length codes — the classic way this gets written wrong.
    expect(isValidGtin("12345670")).toBe(true); // valid EAN-8
  });

  it("validates every GTIN length", () => {
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
    expect(isValidGtin("9300675024235")).toBe(true); // EAN-13
    expect(isValidGtin("00036000291452")).toBe(true); // GTIN-14
  });

  it("refuses a length the standard does not define", () => {
    expect(isValidGtin("123456789")).toBe(false);
  });
});

describe("unitsPerScan", () => {
  it("counts a carton as its pack size", () => {
    expect(unitsPerScan(12)).toBe(12);
  });

  it("never lets a bad pack size record nothing or count backwards", () => {
    // Zero would let someone scan a carton all afternoon and record nothing;
    // negative would count downwards. Both only surface as an inventory that
    // refuses to add up.
    expect(unitsPerScan(0)).toBe(1);
    expect(unitsPerScan(-5)).toBe(1);
    expect(unitsPerScan(null)).toBe(1);
    expect(unitsPerScan("carton")).toBe(1);
    expect(unitsPerScan(undefined)).toBe(1);
  });
});

describe("tallyScans", () => {
  it("counts repeat scans of the same item as one line", () => {
    const out = tallyScans(["036000291452", "036000291452", "036000291452"]);
    expect(out.tallies).toHaveLength(1);
    expect(out.tallies[0].scans).toBe(3);
  });

  it("tallies mixed packaging of one product together", () => {
    // A cupboard holding the same product in UPC-A and EAN-13 boxes.
    const out = tallyScans(["036000291452", "0036000291452"]);
    expect(out.tallies).toHaveLength(1);
    expect(out.tallies[0].scans).toBe(2);
  });

  it("reports the bad scans instead of swallowing them", () => {
    // A cleaner who scanned four things and sees three counted needs to know
    // which one failed, or they assume the system ate it.
    const out = tallyScans(["036000291452", "036000291453", "9300675024235", ""]);
    expect(out.tallies).toHaveLength(2);
    expect(out.rejected).toHaveLength(2);
    expect(out.rejected.map((r) => r.reason)).toEqual(["BAD_CHECK_DIGIT", "EMPTY"]);
  });

  it("puts the biggest counts first", () => {
    const out = tallyScans([
      "036000291452",
      "9300675024235",
      "9300675024235",
      "9300675024235",
    ]);
    expect(out.tallies[0].scans).toBe(3);
  });

  it("has nothing to say about an empty run", () => {
    expect(tallyScans([])).toEqual({ tallies: [], rejected: [] });
  });
});
