import { describe, it, expect } from "vitest";
import {
  DEFAULT_SEQUENCES,
  formatInvoiceNumber,
  legacyFallbackNumber,
  normaliseSequenceInput,
  parseInvoiceNumber,
  previewNextInvoiceNumber,
  type InvoiceSequenceShape,
} from "@/lib/billing/invoice-numbering";

const CLIENT: InvoiceSequenceShape = { prefix: "INV-", lastNumber: 40, padding: 4 };

describe("formatInvoiceNumber", () => {
  it("pads to the configured width", () => {
    expect(formatInvoiceNumber(CLIENT, 41)).toBe("INV-0041");
    expect(formatInvoiceNumber({ ...CLIENT, padding: 6 }, 41)).toBe("INV-000041");
  });

  it("GROWS past the padding rather than wrapping or truncating", () => {
    // The whole point of a sequence is that a number is used once. Trimming
    // 10000 back to four characters would re-issue 0000, and wrapping would
    // re-issue 0001 — either way two documents end up carrying one number.
    expect(formatInvoiceNumber(CLIENT, 10_000)).toBe("INV-10000");
    expect(formatInvoiceNumber(CLIENT, 123_456)).toBe("INV-123456");
  });

  it("keeps the two rails visibly different", () => {
    expect(formatInvoiceNumber(DEFAULT_SEQUENCES.CLIENT, 1)).toBe("INV-0001");
    expect(formatInvoiceNumber(DEFAULT_SEQUENCES.CLEANER, 1)).toBe("PAY-0001");
  });

  it("never renders a negative or fractional number", () => {
    expect(formatInvoiceNumber(CLIENT, -5)).toBe("INV-0000");
    expect(formatInvoiceNumber(CLIENT, 41.9)).toBe("INV-0041");
  });

  it("survives a zero or oversized padding rather than producing a bare prefix", () => {
    expect(formatInvoiceNumber({ ...CLIENT, padding: 0 }, 41)).toBe("INV-41");
    expect(formatInvoiceNumber({ ...CLIENT, padding: 99 }, 41)).toBe(
      `INV-${"41".padStart(10, "0")}`
    );
  });
});

describe("previewNextInvoiceNumber", () => {
  it("shows the number the NEXT invoice will carry, not the last one issued", () => {
    // lastNumber is the last one ISSUED. An admin shown "INV-0040" here would
    // set the counter one too low to dodge a duplicate that was never coming.
    expect(previewNextInvoiceNumber(CLIENT)).toBe("INV-0041");
  });

  it("starts a fresh sequence at one", () => {
    expect(previewNextInvoiceNumber(DEFAULT_SEQUENCES.CLIENT)).toBe("INV-0001");
  });
});

describe("normaliseSequenceInput", () => {
  it("accepts a plain whole number", () => {
    const out = normaliseSequenceInput({ prefix: "INV-", lastNumber: 40, padding: 4 });
    expect(out).toEqual({ ok: true, value: { prefix: "INV-", lastNumber: 40, padding: 4 } });
  });

  it("REFUSES a fractional number instead of rounding it", () => {
    // Rounding 41.7 to 41 sets the counter somewhere the person did not choose,
    // and the first they hear of it is an invoice carrying a number a client has
    // already paid against.
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: 41.7 }).ok).toBe(false);
  });

  it("refuses a negative number", () => {
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: -1 }).ok).toBe(false);
  });

  it("accepts zero — a business that has never invoiced starts there", () => {
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: 0 }).ok).toBe(true);
  });

  it("rejects a prefix carrying characters that break a filename or a CSV cell", () => {
    // These numbers become PDF filenames and Xero export cells.
    for (const bad of ["IN/V-", "IN\\V-", "IN:V-", "IN,V-", 'IN"V-', "IN|V-", "IN*V-"]) {
      expect(normaliseSequenceInput({ prefix: bad, lastNumber: 1 }).ok, bad).toBe(false);
    }
  });

  it("allows an empty prefix — a bare number is a legitimate choice", () => {
    const out = normaliseSequenceInput({ prefix: "", lastNumber: 5, padding: 3 });
    expect(out).toEqual({ ok: true, value: { prefix: "", lastNumber: 5, padding: 3 } });
  });

  it("trims the prefix so a stray space cannot become part of every number", () => {
    const out = normaliseSequenceInput({ prefix: "  INV-  ", lastNumber: 1 });
    expect(out.ok && out.value.prefix).toBe("INV-");
  });

  it("defaults padding when it is not supplied, rather than failing", () => {
    const out = normaliseSequenceInput({ prefix: "INV-", lastNumber: 1 });
    expect(out.ok && out.value.padding).toBe(4);
  });

  it("bounds padding on both sides", () => {
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: 1, padding: 0 }).ok).toBe(false);
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: 1, padding: 11 }).ok).toBe(false);
  });

  it("rejects a number too large to be a real invoice count", () => {
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: 100_000_000 }).ok).toBe(false);
  });

  it("rejects text where a number belongs", () => {
    expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: "forty" }).ok).toBe(false);
  });

  it("rejects an ABSENT number rather than reading it as zero", () => {
    // Number(null) and Number("") are both 0. A field that failed to serialise,
    // or a form submitted with the box cleared, would otherwise reset the
    // counter to zero and re-issue every number from 1 — silently, and against
    // invoices clients already hold.
    for (const empty of [null, undefined, "", "   "]) {
      expect(normaliseSequenceInput({ prefix: "INV-", lastNumber: empty }).ok, String(empty)).toBe(
        false
      );
    }
  });

  it("still accepts a numeric string, which is what a form field sends", () => {
    const out = normaliseSequenceInput({ prefix: "INV-", lastNumber: "40" });
    expect(out.ok && out.value.lastNumber).toBe(40);
  });
});

describe("parseInvoiceNumber", () => {
  it("reads back a number this sequence issued", () => {
    expect(parseInvoiceNumber(CLIENT, "INV-0041")).toBe(41);
    expect(parseInvoiceNumber(CLIENT, "INV-123456")).toBe(123456);
  });

  it("REFUSES the legacy random format", () => {
    // `INV-20260823-A1B2C3` was never part of a sequence. Reading it as one
    // would let a legacy invoice drag the counter to 20,260,823.
    expect(parseInvoiceNumber(CLIENT, "INV-20260823-A1B2C3")).toBeNull();
  });

  it("does not read another rail's numbers", () => {
    expect(parseInvoiceNumber(CLIENT, "PAY-0041")).toBeNull();
    expect(parseInvoiceNumber(DEFAULT_SEQUENCES.CLEANER, "INV-0041")).toBeNull();
  });

  it("returns null for anything that is not a number after the prefix", () => {
    expect(parseInvoiceNumber(CLIENT, "INV-")).toBeNull();
    expect(parseInvoiceNumber(CLIENT, "INV-4A1")).toBeNull();
    expect(parseInvoiceNumber(CLIENT, "")).toBeNull();
  });

  it("does not match everything when the prefix is empty", () => {
    // An empty prefix makes startsWith("") true for every string, which would
    // otherwise read "PAY-0041" as belonging to the bare sequence.
    const bare: InvoiceSequenceShape = { prefix: "", lastNumber: 0, padding: 4 };
    expect(parseInvoiceNumber(bare, "PAY-0041")).toBeNull();
  });

  it("round-trips whatever it formats", () => {
    for (const n of [1, 9, 10, 999, 1000, 99_999]) {
      expect(parseInvoiceNumber(CLIENT, formatInvoiceNumber(CLIENT, n))).toBe(n);
    }
  });
});

describe("legacyFallbackNumber", () => {
  it("keeps the exact old shape, so an unmigrated environment still invoices", () => {
    expect(legacyFallbackNumber(new Date(2026, 7, 23, 10, 30), "a1b2c3d4e5")).toBe(
      "INV-20260823-A1B2C3"
    );
  });

  it("pads single-digit months and days", () => {
    expect(legacyFallbackNumber(new Date(2026, 0, 5), "abcdef")).toBe("INV-20260105-ABCDEF");
  });

  it("is never mistaken for a sequence number", () => {
    // If a fallback parsed, it could drag the counter forward by millions the
    // moment somebody reconciled the sequence against the invoices on file.
    const fallback = legacyFallbackNumber(new Date(2026, 7, 23), "a1b2c3");
    expect(parseInvoiceNumber(DEFAULT_SEQUENCES.CLIENT, fallback)).toBeNull();
  });
});
