/**
 * Pure, isomorphic (server + client safe) helpers for coercing possibly-HTML
 * strings into plain display text.
 *
 * Quote-authored summary / instruction strings can carry HTML markup (e.g. a
 * quote description pasted from a rich-text editor). Those strings flow verbatim
 * into form-schema `description` / `instructions` / label fields, and our
 * renderers display them as escaped literal text — so a `<br>` shows up as the
 * characters "<br>" instead of a line break. `stripHtmlToText` normalises such a
 * string back to readable plain text.
 *
 * Constraints (do NOT break these — other modules import `stripHtmlToText`):
 *   - No DOM APIs (no `document`, `DOMParser`) and no server-only imports.
 *   - Regex / string based only, so it runs identically in RSC, route handlers,
 *     and the browser.
 *   - Must be a no-op on plain text (no markup, no entities → returned trimmed).
 *
 * Examples:
 *   stripHtmlToText("Hello")                    === "Hello"
 *   stripHtmlToText("Line 1<br>Line 2")         === "Line 1\nLine 2"
 *   stripHtmlToText("<p>One</p><p>Two</p>")     === "One\nTwo"
 *   stripHtmlToText("<ul><li>A</li><li>B</li></ul>") === "• A\n• B"
 *   stripHtmlToText("Tom &amp; Jerry")          === "Tom & Jerry"
 *   stripHtmlToText("a &lt;tag&gt; b")          === "a <tag> b"
 *   stripHtmlToText("<b>Bold</b> text")         === "Bold text"
 */

/** Decode the small set of HTML entities we expect from quote-authored copy. */
function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    // Common numeric entity for the apostrophe.
    .replace(/&#0*39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    // Ampersand LAST so we don't double-decode (e.g. "&amp;lt;" → "&lt;").
    .replace(/&amp;/gi, "&");
}

/**
 * Convert an HTML-ish string to plain text. Safe no-op on plain text.
 */
export function stripHtmlToText(input: string): string {
  if (input == null) return "";
  let s = String(input);

  // Fast path: nothing that looks like markup or an entity → just trim.
  if (!/[<&]/.test(s)) return s.trim();

  // Drop script/style blocks entirely (defence-in-depth; unlikely in copy).
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  // List items → bullet markers. The opening tag emits the break + bullet, so
  // `</li>` is intentionally NOT in the closing-tag list below (avoids a blank
  // line between bullets).
  s = s.replace(/<li\b[^>]*>/gi, "\n• ");

  // Explicit line breaks and block-level closers → newlines. Using closers only
  // (not openers) keeps a single break between adjacent blocks like <p>…</p><p>…
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|ul|ol|h[1-6]|tr|section|article|header|footer|blockquote)\s*>/gi, "\n");

  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, "");

  // Decode entities after tag removal.
  s = decodeEntities(s);

  // Normalise whitespace: CRLF → LF, trim trailing spaces on each line,
  // collapse 3+ newlines to 2, and trim the whole thing.
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}
