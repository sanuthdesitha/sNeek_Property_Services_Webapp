/**
 * Text that may leave the app (System health "Copy details for support", the
 * stored worker run error). Plain module, no server imports.
 *
 * Removes what must never be copied: bearer tokens and API keys, secrets in
 * `key=value` or JSON form, URL query strings and passwords in URLs, long
 * opaque strings (tokens, signed links), email addresses and phone numbers
 * (client and staff data). Keeps the shape of the message so it still says
 * what went wrong. One line, bounded.
 */
const MAX_LENGTH = 400;

const SECRET_NAMES = "(?:api[_-]?key|apikey|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|pwd|authorization|auth|signature|sig|key|appkey|credential|credentials|session|cookie)";

export function redactSupportText(input: unknown, maxLength = MAX_LENGTH): string {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  const redacted = text
    // Authorization: Bearer xxx / Basic xxx
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    // user:password@host in URLs
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    // query strings and fragments of URLs
    .replace(/(\bhttps?:\/\/[^\s?#"']+)[?#][^\s"']*/gi, "$1?[redacted]")
    // "token": "…", token=…, api_key: …
    .replace(new RegExp(`(["']?\\b${SECRET_NAMES}\\b["']?\\s*[:=]\\s*)(["']?)[^\\s"',;&]+\\2`, "gi"), "$1[redacted]")
    // well-known key shapes
    .replace(/\b(?:sk|pk|rk|re|whsec|xox[abp])_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    // email addresses
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    // phone numbers (8+ digits, with spaces, dashes or a leading +)
    .replace(/(?<![\w.])\+?\d[\d\s-]{7,}\d(?![\w.])/g, "[phone]")
    // long opaque strings: tokens, hashes, signed ids
    .replace(/\b[A-Za-z0-9._~+/=-]{32,}\b/g, "[redacted]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}…` : redacted;
}
