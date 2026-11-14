import { parseDocument } from "./checks";
import { sanitizeTheme } from "./theme";
import type { EmailDocument, EmailTheme } from "./types";

/**
 * What an already-rendered email carries so the send path can render it again
 * at send time (published version, published theme, current company details)
 * and check its required values. Plain module.
 *
 * The spec is one HTML comment (base64 JSON) before </body>. The send path
 * strips it before anything reaches the provider; values in it are the same
 * values already in the HTML.
 */
export type EmailSpec = {
  v: 1;
  /** "design": a block design by key. "legacy": an HTML body put on the base layout. */
  kind: "design" | "legacy";
  /** Design key, or for "legacy" the shared template key it came from ("" for none). */
  key: string;
  values: Record<string, string>;
  /** The subject as rendered when the email was built (to recognise a caller's prefix). */
  subject: string;
  /** "legacy": the escaped body HTML (a stored raw-HTML template or a code fragment). */
  body?: string;
  /** "legacy": the inferred button. */
  action?: { url: string; label: string } | null;
  /** "legacy": a security email (no preferences link, no reply-to). */
  security?: boolean;
  /** Test sends only: the draft document to send instead of the published one. */
  doc?: EmailDocument;
  /** Test sends only: the draft Email look to use instead of the published one. */
  theme?: EmailTheme;
};

const OPEN = "<!--sneek-email-spec:";
const CLOSE = "-->";
const SPEC_PATTERN = /<!--sneek-email-spec:([A-Za-z0-9+/=]+)-->/;

function toBase64(text: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(text, "utf8").toString("base64");
  return btoa(unescape(encodeURIComponent(text)));
}

function fromBase64(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
  return decodeURIComponent(escape(atob(value)));
}

export function embedSpec(html: string, spec: EmailSpec): string {
  const comment = `${OPEN}${toBase64(JSON.stringify(spec))}${CLOSE}`;
  const index = html.lastIndexOf("</body>");
  return index === -1 ? `${html}${comment}` : `${html.slice(0, index)}${comment}${html.slice(index)}`;
}

function parseSpec(value: unknown): EmailSpec | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1 || (row.kind !== "design" && row.kind !== "legacy") || typeof row.key !== "string" || typeof row.subject !== "string") return null;
  const values: Record<string, string> = {};
  if (row.values && typeof row.values === "object") {
    for (const [name, raw] of Object.entries(row.values as Record<string, unknown>)) values[name] = typeof raw === "string" ? raw : String(raw ?? "");
  }
  const action = row.action && typeof row.action === "object" && typeof (row.action as { url?: unknown }).url === "string"
    ? { url: String((row.action as { url: string }).url), label: String((row.action as { label?: unknown }).label ?? "Open details") }
    : null;
  const doc = row.doc ? parseDocument(row.doc) ?? undefined : undefined;
  const theme = row.theme ? sanitizeTheme(row.theme) : undefined;
  return { v: 1, kind: row.kind, key: row.key, values, subject: row.subject, body: typeof row.body === "string" ? row.body : undefined, action, security: row.security === true, ...(doc ? { doc } : {}), ...(theme ? { theme } : {}) };
}

/** The spec (when present and valid) and the HTML without it. */
export function extractSpec(html: string): { spec: EmailSpec | null; html: string } {
  const match = SPEC_PATTERN.exec(html);
  if (!match) return { spec: null, html };
  const stripped = html.replace(SPEC_PATTERN, "");
  try {
    return { spec: parseSpec(JSON.parse(fromBase64(match[1]))), html: stripped };
  } catch {
    return { spec: null, html: stripped };
  }
}

/**
 * The subject to send: the newly rendered subject, keeping anything the caller
 * added around the original (e.g. "[Test] "). A subject the caller replaced
 * entirely is kept as the caller wrote it.
 */
export function resolveSubject(payloadSubject: string, spec: EmailSpec, rendered: string): string {
  if (!spec.subject || payloadSubject === spec.subject) return rendered;
  const index = payloadSubject.indexOf(spec.subject);
  if (index === -1) return payloadSubject;
  return `${payloadSubject.slice(0, index)}${rendered}${payloadSubject.slice(index + spec.subject.length)}`;
}
