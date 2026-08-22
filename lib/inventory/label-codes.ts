/**
 * THE BARCODES WE PRINT OURSELVES.
 *
 * Distinct from `lib/inventory/barcodes.ts`, which canonicalises the codes
 * manufacturers put on packaging. This mints our own, for the far more common
 * case: a product with no barcode at all (decanted chemicals, bulk cloths), a
 * label that has worn off, or a shelf we simply want tagged so a cleaner can
 * point a phone at the SHELF rather than hunt for a bottle's own barcode.
 *
 * WHAT GOES IN THE CODE: nothing. It is an opaque token that resolves to a row.
 *
 * The tempting alternative — encoding the item and property ids into the
 * barcode — fails on contact with a label printer. Ids are long, so the barcode
 * becomes physically wide and unreliable to scan; the label then leaks internal
 * identifiers to anyone who photographs it; and worst, a label printed in March
 * still asserts a relationship in December, after the item has been renamed,
 * merged or discontinued. A token that resolves through the database is always
 * current, and a retired one simply stops working.
 *
 * SHAPE: `SNK-` plus eight characters from an unambiguous alphabet. The prefix
 * makes a stray scan self-identifying ("this is one of ours"), and the alphabet
 * excludes O/0 and I/1 so a human reading a smudged label aloud to the office
 * cannot say the wrong thing.
 *
 * PURE — no DB, no I/O. Randomness is injected so the generator is testable.
 */

/**
 * Crockford-style alphabet: no O, I, L or U.
 *
 * O/0 and I/1 are the pairs people confuse reading a label out; U is dropped
 * because it turns up in words nobody wants printed on a shelf tag by accident.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Prefix that makes one of our labels recognisable on sight. */
export const LABEL_PREFIX = "SNK-";

/** Body length. Eight characters of a 32-symbol alphabet is 40 bits. */
const BODY_LENGTH = 8;

export type BarcodeSymbology = "CODE128" | "QR";

/**
 * Which symbology to print.
 *
 * CODE128 is the default because it is what people mean by "a barcode", prints
 * as a compact strip on a shelf tag, and reads on any handheld scanner the
 * business might later buy.
 *
 * QR is offered because cleaners scan with PHONES, and a phone camera acquires
 * a QR far faster, at worse angles, and with more of the label damaged or
 * grease-covered. On a shelf in a dim cupboard that difference is real.
 */
export const DEFAULT_SYMBOLOGY: BarcodeSymbology = "CODE128";

/**
 * Mint a label code.
 *
 * `random` is injected rather than called directly so a test can prove the
 * alphabet and the shape without depending on chance.
 */
export function generateLabelCode(random: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    const index = Math.floor(random() * ALPHABET.length);
    // Guard a random() that returns exactly 1, or anything out of range: an
    // undefined character here would silently shorten every code it touched.
    body += ALPHABET[Math.min(Math.max(index, 0), ALPHABET.length - 1)];
  }
  return `${LABEL_PREFIX}${body}`;
}

/** Is this one of ours? Routes a scan before the database is touched. */
export function isLabelCode(code: unknown): boolean {
  return normalizeLabelCode(code) !== null;
}

/**
 * Tidy a scanned or hand-typed label code into its stored form.
 *
 * Case is normalised and separators dropped, because someone reading a smudged
 * tag down the phone will not reproduce the hyphen reliably. Returns null when
 * it is not one of ours, so the caller can fall back to treating the scan as a
 * manufacturer barcode.
 */
export function normalizeLabelCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!compact.startsWith("SNK")) return null;
  const body = compact.slice(3);
  if (body.length !== BODY_LENGTH) return null;
  if (!body.split("").every((ch) => ALPHABET.includes(ch))) return null;
  return `${LABEL_PREFIX}${body}`;
}

/** What a printed label says under the barcode, so a human can read it too. */
export interface LabelPrintData {
  code: string;
  itemName: string;
  /** Property name for a pinned label; absent means it works anywhere. */
  propertyName?: string | null;
  unit?: string | null;
}

/**
 * The human-readable caption under the bars.
 *
 * A barcode nobody can read without a scanner is unusable the moment the
 * scanner fails — and it fails at the worst moment. The caption is what lets
 * someone type the code in, or simply recognise the right shelf.
 */
export function labelCaption(data: LabelPrintData): string {
  const parts = [data.itemName];
  parts.push(data.propertyName ? data.propertyName : "Any property");
  if (data.unit) parts.push(`per ${data.unit}`);
  return parts.join(" · ");
}
