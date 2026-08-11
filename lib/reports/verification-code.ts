// Pure string helpers for report verification codes. Client-safe: no crypto,
// no database — the form imports these, so nothing server-only may live here.

/**
 * Crockford base32: no I, L, O, U — codes survive handwriting and phone calls.
 * 16 symbols × 5 bits = 80 bits of entropy; unguessable and non-enumerable.
 */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 16;

/** "ABCD-EFGH-JKMN-PQRS" — how the code prints on reports and the form. */
export function formatVerificationCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * Accepts human input: case-insensitive, ignores dashes/spaces, maps the
 * Crockford ambiguity set (I/L→1, O→0). Returns null when the cleaned value
 * cannot be a code.
 */
export function normalizeVerificationCode(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}
