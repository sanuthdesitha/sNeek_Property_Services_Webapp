/**
 * TURNING WHAT THE SCANNER SAW INTO SOMETHING WE CAN LOOK UP.
 *
 * This module exists because of one failure that quietly ruins barcode
 * inventories: the same physical product scans differently depending on the
 * label and the reader. A tin printed with a UPC-A barcode reports twelve
 * digits; the identical tin in an EAN-13 country reports thirteen, and the only
 * difference is a leading zero. Store the raw strings and that one tin becomes
 * two items — each holding half the stock, each triggering its own reorder, and
 * nobody able to see why the numbers never add up.
 *
 * So every numeric code is canonicalised to **GTIN-14**, zero-padded. EAN-8,
 * UPC-A, EAN-13 and GTIN-14 all collapse onto one key, which is what the
 * standard intends and what makes lookup a single equality check.
 *
 * The check digit is verified, not assumed. A misread barcode usually fails the
 * checksum, and catching it here means a cleaner is told "that did not scan
 * properly, try again" rather than silently counting stock against the wrong
 * product — which is worse than not counting it at all.
 *
 * Non-numeric symbologies (CODE_128 asset tags, QR labels) are not GTINs and
 * pass through trimmed and upper-cased. They are still unique keys; they simply
 * have no arithmetic to check.
 *
 * PURE — no DB, no I/O.
 */

/** What a scan resolved to, and whether it can be trusted. */
export type BarcodeKind = "GTIN" | "OPAQUE" | "INVALID";

export interface NormalizedBarcode {
  /** The value to store and look up by. Empty when kind is INVALID. */
  code: string;
  kind: BarcodeKind;
  /** Why it was rejected, so the person holding the phone can act on it. */
  reason?: "EMPTY" | "BAD_CHECK_DIGIT" | "BAD_LENGTH";
}

/** GTIN lengths the standard defines. Anything else numeric is not a GTIN. */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * The GS1 check digit: weight each digit 3,1,3,1… from the right (excluding the
 * check digit itself), sum, and the check digit is whatever takes that sum up
 * to the next multiple of ten. It works for every GTIN length, which is why
 * this is done once here rather than per symbology.
 */
export function gtinCheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  // Weighting is anchored to the RIGHT, so it has to be computed from the end.
  // Anchoring left silently inverts the weights on odd-length codes.
  for (
    let i = digitsWithoutCheck.length - 1, weight = 3;
    i >= 0;
    i -= 1, weight = weight === 3 ? 1 : 3
  ) {
    sum += Number(digitsWithoutCheck[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(digits: string): boolean {
  if (!GTIN_LENGTHS.has(digits.length)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  return gtinCheckDigit(body) === check;
}

/**
 * Normalise a raw scan.
 *
 * Hand-typed codes arrive with the spaces and hyphens printed on the packaging,
 * and refusing those would push people to skip the barcode entirely and type a
 * quantity instead — so separators are ignored when deciding whether this is a
 * GTIN. They are NOT removed from an opaque code's stored value; see below.
 */
export function normalizeBarcode(raw: unknown): NormalizedBarcode {
  if (typeof raw !== "string") return { code: "", kind: "INVALID", reason: "EMPTY" };

  const trimmed = raw.trim();
  if (!trimmed) return { code: "", kind: "INVALID", reason: "EMPTY" };

  // Separators are stripped only to TEST for a GTIN. They must not be
  // stripped from the stored value of an opaque code: in an asset tag like
  // "SNEEK-ASSET-0042" the hyphens are part of the identity, and removing
  // them would merge two genuinely different labels onto one key — the same
  // collision this module exists to prevent, arrived at from the other side.
  const cleaned = trimmed.replace(/[\s-]/g, "");

  if (!/^\d+$/.test(cleaned)) {
    // Not a GTIN. Still a unique key, just one with no arithmetic to check.
    return { code: trimmed.toUpperCase(), kind: "OPAQUE" };
  }

  if (!GTIN_LENGTHS.has(cleaned.length)) {
    return { code: "", kind: "INVALID", reason: "BAD_LENGTH" };
  }

  if (!isValidGtin(cleaned)) {
    // Almost always a misread rather than a counterfeit. Telling the cleaner to
    // rescan beats counting stock against the wrong item.
    return { code: "", kind: "INVALID", reason: "BAD_CHECK_DIGIT" };
  }

  return { code: cleaned.padStart(14, "0"), kind: "GTIN" };
}

/** Plain-language rejections, for someone standing at a cupboard. */
export const BARCODE_REJECTION_MESSAGE: Record<
  NonNullable<NormalizedBarcode["reason"]>,
  string
> = {
  EMPTY: "Nothing scanned — try again.",
  BAD_LENGTH: "That is not a product barcode. Add the item by name instead.",
  BAD_CHECK_DIGIT: "That did not scan cleanly. Line it up and try again.",
};

/**
 * How many stock units one scan represents.
 *
 * Guarded rather than trusted: a pack size of zero would let someone scan a
 * carton all afternoon and record nothing, and a negative one would count
 * downwards. Both are data-entry slips that surface only as an inventory which
 * refuses to add up.
 */
export function unitsPerScan(packSize: unknown): number {
  const size = Number(packSize);
  return Number.isFinite(size) && size > 0 ? size : 1;
}

export interface ScanTally {
  code: string;
  scans: number;
}

export interface TallyResult {
  tallies: ScanTally[];
  rejected: Array<{ raw: string; reason: NonNullable<NormalizedBarcode["reason"]> }>;
}

/**
 * Fold a session of raw scans into a per-barcode tally.
 *
 * Counting happens on the CANONICAL code, so a cupboard holding the same
 * product in both UPC-A and EAN-13 packaging tallies as one line rather than
 * two. Invalid scans are returned separately instead of dropped — a cleaner who
 * scanned eleven things and sees ten counted needs to know which one failed, or
 * they will assume the system ate it.
 */
export function tallyScans(rawScans: readonly string[]): TallyResult {
  const counts = new Map<string, number>();
  const rejected: TallyResult["rejected"] = [];

  for (const raw of rawScans) {
    const normalized = normalizeBarcode(raw);
    if (normalized.kind === "INVALID") {
      rejected.push({ raw: String(raw), reason: normalized.reason ?? "EMPTY" });
      continue;
    }
    counts.set(normalized.code, (counts.get(normalized.code) ?? 0) + 1);
  }

  return {
    // Most-scanned first: someone reviewing the summary is checking the big
    // numbers, and a single stray scan sorts to the end where it stands out.
    tallies: Array.from(counts.entries())
      .map(([code, scans]) => ({ code, scans }))
      .sort((a, b) => b.scans - a.scans || a.code.localeCompare(b.code)),
    rejected,
  };
}
